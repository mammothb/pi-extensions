use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(transparent)]
pub struct RequestId(pub Uuid);

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(transparent)]
pub struct SessionId(pub Uuid);

/// Top-level frame. `id` is a per-frame unique string (not parsed by daemon).
#[derive(Debug, Deserialize, Serialize)]
pub struct MessageEnvelope {
    pub id: Uuid,
    pub timestamp: String,
    #[serde(flatten)]
    pub event: EventType,
}

#[derive(Debug, Deserialize, Serialize)]
pub enum EventType {
    // session.*
    #[serde(rename = "session.register")]
    SessionRegister {
        session_id: SessionId,
        project_path: PathBuf,
    },

    #[serde(rename = "session.unregister")]
    SessionUnregister { session_id: SessionId },

    // review.*
    #[serde(rename = "review.submit")]
    ReviewSubmit {
        request_id: RequestId,
        project_path: PathBuf,
        snippet: String,
    },

    #[serde(rename = "review.ack")]
    ReviewAck {
        request_id: RequestId,
        #[serde(flatten)]
        outcome: AckOutcome,
    },

    #[serde(rename = "review.requested")]
    ReviewRequested {
        request_id: RequestId,
        snippet: String,
    },

    #[serde(rename = "review.completed")]
    ReviewCompleted {
        request_id: RequestId,
        review: String,
    },

    // report.*
    #[serde(rename = "report.submit")]
    ReportSubmit {
        request_id: RequestId,
        session_id: SessionId,
        content: String,
    },

    #[serde(rename = "report.delivered")]
    ReportDelivered {
        request_id: RequestId,
        content: String,
    },

    #[serde(rename = "report.completed")]
    ReportCompleted {
        request_id: RequestId,
        report: String,
    },
}

/// Outcome of a review request. Flattened into `review.ack` with the variant
/// tag serialized as `status` (e.g. `{"status": "accepted", ...}`), preserving
/// the wire format of the former `status` + optional field layout.
#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum AckOutcome {
    Accepted {
        session_id: SessionId,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    Rejected {
        reason: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
}
