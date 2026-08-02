use crate::types::MessageEnvelope;

pub const PROTOCOL_VERSION: u8 = 0x01;
/// Size of the length prefix in bytes (u32 big-endian).
pub const LENGTH_PREFIX_SIZE: usize = 4;
/// Maximum accepted declared frame body size (version byte + payload),
/// excluding the 4-byte length prefix. The total encoded frame on the wire
/// may be up to `LENGTH_PREFIX_SIZE` bytes larger than this limit.
/// Guards the frame reader against a malicious peer declaring a huge
/// length: a 4-byte prefix must never force a multi-GB allocation.
pub const MAX_FRAME_SIZE: usize = 1 << 20; // 1 MiB

/// Serializes a MessageEnvelope into a length-prefixed frame.
pub fn encode(msg: &MessageEnvelope) -> Result<Vec<u8>, FrameError> {
    let msg_bytes = serde_json::to_vec(msg)?;
    let payload_len = (1 + msg_bytes.len()) as u32; // version + JSON

    let mut frame = Vec::with_capacity(LENGTH_PREFIX_SIZE + payload_len as usize);
    frame.extend_from_slice(&payload_len.to_be_bytes());
    frame.push(PROTOCOL_VERSION);
    frame.extend_from_slice(&msg_bytes);

    Ok(frame)
}

/// Deserializes a frame into a MessageEnvelope.
/// Returns `FrameError::UnsupportedVersion` if version byte doesn't match.
/// Returns `FrameError::InvalidEnvelope` if payload isn't valid JSON.
pub fn decode(frame: &[u8]) -> Result<MessageEnvelope, FrameError> {
    let (len_bytes, rest) = frame
        .split_first_chunk::<LENGTH_PREFIX_SIZE>()
        .ok_or(FrameError::TooShort(frame.len()))?;
    let declared = u32::from_be_bytes(*len_bytes);

    if declared as usize > MAX_FRAME_SIZE {
        return Err(FrameError::TooLarge(declared));
    }

    if rest.len() != declared as usize {
        return Err(FrameError::LengthMismatch {
            declared,
            actual: rest.len() as u32,
        });
    }

    let (&version, msg_bytes) = rest
        .split_first()
        .ok_or(FrameError::TooShort(frame.len()))?;
    if version != PROTOCOL_VERSION {
        return Err(FrameError::UnsupportedVersion(version));
    }

    let msg = serde_json::from_slice(msg_bytes)?;

    Ok(msg)
}

#[derive(Debug, thiserror::Error)]
pub enum FrameError {
    #[error("invalid envelope: {0}")]
    InvalidEnvelope(#[from] serde_json::Error),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("length mismatch: declared {declared}, actual {actual}")]
    LengthMismatch { declared: u32, actual: u32 },
    #[error("frame too large: declared {0} bytes")]
    TooLarge(u32),
    #[error("frame too short: {0} bytes")]
    TooShort(usize),
    #[error("unsupported protocol version: {0}")]
    UnsupportedVersion(u8),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{AckOutcome, EventType, RequestId, SessionId};
    use rstest::rstest;
    use serde::{Serialize, de::DeserializeOwned};
    use uuid::Uuid;

    fn envelope(event: EventType) -> MessageEnvelope {
        MessageEnvelope {
            id: Uuid::from_bytes([0xAA; 16]),
            timestamp: "2026-01-01T00:00:00Z".to_string(),
            event,
        }
    }

    fn request_id() -> RequestId {
        RequestId(Uuid::from_bytes([0xBB; 16]))
    }

    fn session_id() -> SessionId {
        SessionId(Uuid::from_bytes([0xCC; 16]))
    }

    /// Roundtrips `T` through serde as a bare UUID string and back — the
    /// `#[serde(transparent)]` property shared by both newtypes.
    fn assert_transparent_uuid_roundtrip<T: Serialize + DeserializeOwned>(
        wrap: impl Fn(Uuid) -> T,
    ) {
        let id = Uuid::from_bytes([0xCC; 16]);
        let value = serde_json::to_value(wrap(id)).unwrap();
        assert_eq!(value, serde_json::Value::String(id.to_string()));
        let _back: T = serde_json::from_value(value.clone()).unwrap();
        // Transparent wrapper: the bare string deserializes straight into a Uuid.
        let back: Uuid = serde_json::from_value(value).unwrap();
        assert_eq!(back, id);
    }

    #[rstest]
    #[case::session_register(EventType::SessionRegister {
        session_id: session_id(),
        project_path: "/proj/a".into(),
    })]
    #[case::session_unregister(EventType::SessionUnregister {
        session_id: session_id(),
    })]
    #[case::review_submit(EventType::ReviewSubmit {
        request_id: request_id(),
        project_path: "/proj/b".into(),
        snippet: "fn main() {}".into(),
    })]
    #[case::review_ack(EventType::ReviewAck {
        request_id: request_id(),
        outcome: AckOutcome::Rejected {
            reason: "duplicate".into(),
            message: Some("already handled".into()),
        },
    })]
    #[case::review_ack_accepted(EventType::ReviewAck {
        request_id: request_id(),
        outcome: AckOutcome::Accepted {
            session_id: session_id(),
            message: None,
        },
    })]
    #[case::review_requested(EventType::ReviewRequested {
        request_id: request_id(),
        snippet: "let x = 1;".into(),
    })]
    #[case::review_completed(EventType::ReviewCompleted {
        request_id: request_id(),
        review: "looks good".into(),
    })]
    #[case::report_submit(EventType::ReportSubmit {
        request_id: request_id(),
        session_id: session_id(),
        content: "report body".into(),
    })]
    #[case::report_delivered(EventType::ReportDelivered {
        request_id: request_id(),
        content: "report body".into(),
    })]
    #[case::report_completed(EventType::ReportCompleted {
        request_id: request_id(),
        report: "final report".into(),
    })]
    fn roundtrip_all_event_types(#[case] event: EventType) {
        let msg = envelope(event);
        let decoded = decode(&encode(&msg).unwrap()).unwrap();
        assert_eq!(
            serde_json::to_value(&decoded).unwrap(),
            serde_json::to_value(&msg).unwrap()
        );
    }

    #[rstest]
    fn version_byte_in_frame() {
        let msg = envelope(EventType::ReviewRequested {
            request_id: request_id(),
            snippet: "let x = 1;".into(),
        });
        let frame = encode(&msg).unwrap();
        assert_eq!(frame[4], 0x01, "version byte at index 4");
        assert_eq!(frame[4], PROTOCOL_VERSION);
    }

    #[rstest]
    fn unsupported_version_rejected() {
        let msg = envelope(EventType::SessionUnregister {
            session_id: session_id(),
        });
        let msg_bytes = serde_json::to_vec(&msg).unwrap();
        let mut frame = Vec::new();
        frame.extend_from_slice(&((1 + msg_bytes.len()) as u32).to_be_bytes());
        frame.push(0xFF);
        frame.extend_from_slice(&msg_bytes);

        assert!(matches!(
            decode(&frame),
            Err(FrameError::UnsupportedVersion(0xFF))
        ));
    }

    #[rstest]
    fn too_short_frame() {
        assert!(matches!(decode(&[1u8, 2, 3]), Err(FrameError::TooShort(3))));
    }

    #[rstest]
    fn length_mismatch() {
        let mut frame = Vec::new();
        frame.extend_from_slice(&10u32.to_be_bytes());
        frame.extend_from_slice(&[0u8; 5]);
        assert!(matches!(
            decode(&frame),
            Err(FrameError::LengthMismatch {
                declared: 10,
                actual: 5
            })
        ));
    }

    #[rstest]
    fn declared_too_large() {
        let mut frame = Vec::new();
        frame.extend_from_slice(&u32::MAX.to_be_bytes());
        frame.extend_from_slice(&[0u8; 4]);
        assert!(matches!(
            decode(&frame),
            Err(FrameError::TooLarge(declared)) if declared == u32::MAX
        ));
    }

    #[rstest]
    fn declared_at_limit_passes_size_check() {
        let mut frame = Vec::new();
        frame.extend_from_slice(&(MAX_FRAME_SIZE as u32).to_be_bytes());
        frame.extend_from_slice(&[0u8; 4]);
        // At the limit the max check passes; the short actual payload then
        // fails the length check instead.
        assert!(matches!(
            decode(&frame),
            Err(FrameError::LengthMismatch {
                declared,
                actual: 4
            }) if declared == MAX_FRAME_SIZE as u32
        ));
    }

    #[rstest]
    fn invalid_envelope() {
        let garbage = b"this is not json";
        let mut frame = Vec::new();
        frame.extend_from_slice(&((1 + garbage.len()) as u32).to_be_bytes());
        frame.push(PROTOCOL_VERSION);
        frame.extend_from_slice(garbage);
        assert!(matches!(
            decode(&frame),
            Err(FrameError::InvalidEnvelope(_))
        ));
    }

    #[rstest]
    fn session_id_newtype_serde_roundtrip() {
        assert_transparent_uuid_roundtrip(SessionId);
    }

    #[rstest]
    fn request_id_newtype_serde_roundtrip() {
        assert_transparent_uuid_roundtrip(RequestId);
    }

    #[rstest]
    #[case::accepted(AckOutcome::Accepted {
        session_id: session_id(),
        message: None,
    }, &["reason", "message"][..])]
    #[case::rejected(AckOutcome::Rejected {
        reason: "policy violation".to_string(),
        message: None,
    }, &["session_id", "message"][..])]
    fn ack_omits_unset_optional_fields(#[case] outcome: AckOutcome, #[case] absent: &[&str]) {
        let msg = envelope(EventType::ReviewAck {
            request_id: request_id(),
            outcome,
        });
        let value = serde_json::to_value(&msg).unwrap();
        let event = value.get("review.ack").unwrap().as_object().unwrap();
        for key in absent {
            assert!(event.get(*key).is_none(), "unexpected key `{key}`");
        }
        assert!(event.get("status").is_some());
        assert!(event.get("request_id").is_some());
    }

    #[rstest]
    fn envelope_flattens_event_and_payload() {
        let msg = envelope(EventType::ReviewRequested {
            request_id: request_id(),
            snippet: "let x = 1;".into(),
        });
        let value = serde_json::to_value(&msg).unwrap();
        let obj = value.as_object().unwrap();

        // Envelope fields sit at the top level.
        assert!(obj.contains_key("id"));
        assert!(obj.contains_key("timestamp"));
        // The event is keyed by its type name at the top level.
        assert!(obj.contains_key("review.requested"));
        // Its payload is nested under the event key, not a "payload" wrapper.
        assert!(!obj.contains_key("payload"));
        let payload = obj["review.requested"].as_object().unwrap();
        assert!(payload.contains_key("request_id"));
        assert!(payload.contains_key("snippet"));
    }

    #[rstest]
    fn encode_produces_deterministic_output() {
        let msg = envelope(EventType::ReviewCompleted {
            request_id: request_id(),
            review: "lgtm".into(),
        });
        assert_eq!(encode(&msg).unwrap(), encode(&msg).unwrap());
    }
}
