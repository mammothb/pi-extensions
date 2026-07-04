use std::process::ExitCode;

pub mod compile;
pub mod pi;

#[derive(Copy, Clone)]
pub enum ExitStatus {
    /// The command succeeded
    Success,
    /// The command failed due to error in the user input
    Failure,
    /// The command failed due to an unexpected error
    Error,
}

impl From<ExitStatus> for ExitCode {
    fn from(status: ExitStatus) -> Self {
        match status {
            ExitStatus::Success => Self::from(0),
            ExitStatus::Failure => Self::from(1),
            ExitStatus::Error => Self::from(2),
        }
    }
}
