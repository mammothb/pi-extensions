use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(transparent)]
pub struct RequestId(pub Uuid);

#[derive(Clone, Debug, Deserialize, Serialize)]
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
        status: AckStatus,
        request_id: RequestId,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_id: Option<SessionId>,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
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
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AckStatus {
    Accepted,
    Rejected,
}
