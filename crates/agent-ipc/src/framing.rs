use crate::types::MessageEnvelope;

pub const PROTOCOL_VERSION: u8 = 0x01;
/// Size of the length prefix in bytes (u32 big-endian).
pub const LENGTH_PREFIX_SIZE: usize = 4;

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
    #[error("unsupported protocol version: {0}")]
    UnsupportedVersion(u8),
    #[error("frame too short: {0} bytes")]
    TooShort(usize),
    #[error("length mismatch: declared {declared}, actual {actual}")]
    LengthMismatch { declared: u32, actual: u32 },
    #[error("invalid envelope: {0}")]
    InvalidEnvelope(#[from] serde_json::Error),
}
