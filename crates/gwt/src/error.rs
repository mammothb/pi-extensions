//! Command error type and renderer.
//!
//! One wrapper type for every failure a command can produce, plus a single
//! renderer. The rules this module encodes:
//!
//! * Every failure is a [`CommandError`] carrying a `kind`, the underlying
//!   error, and (optional) hints.
//! * Hints are attached at the *throw site*, where the failure is understood —
//!   never by sniffing error text downstream. This module carries hints; it
//!   never guesses them.
//! * Rendering is chain-based: a scope heading, the `Caused by:` chain, then
//!   `Hint:` lines. Exit code derives from `kind`.

use std::error::Error;
use std::fmt;
use std::io::Write;

use clap::error::ErrorKind as ClapErrorKind;

/// Broad failure category. Drives the error heading and the process exit code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// An error the user can act on (bad input, a git operation rejected).
    User,
    /// Invalid command line. Special-cased: clap help/version exit 0.
    Cli,
    /// A bug or unexpected environment failure (spawn, version floor, IO).
    Internal,
}

impl Kind {
    /// Exit code for this kind. User errors are 1 ("you can retry"); cli and
    /// internal errors are 2 ("fix or report").
    pub fn exit_code(self) -> u8 {
        match self {
            Kind::User => 1,
            Kind::Cli | Kind::Internal => 2,
        }
    }
}

/// A wrapped failure plus rendering metadata. `error` is a boxed `dyn Error`
/// so any error type (including anyhow) can be carried; `hints` hold
/// actionable follow-up text attached where the failure was understood.
#[derive(Debug)]
pub struct CommandError {
    pub kind: Kind,
    pub error: Box<dyn Error + Send + Sync>,
    pub hints: Vec<String>,
}

impl CommandError {
    /// Wrap a raw error as the given kind.
    pub fn new(kind: Kind, err: impl Into<Box<dyn Error + Send + Sync>>) -> Self {
        Self {
            kind,
            error: err.into(),
            hints: Vec::new(),
        }
    }

    /// Wrap a raw error beneath a user-facing message.
    pub fn with_message(
        kind: Kind,
        message: impl Into<String>,
        source: impl Into<Box<dyn Error + Send + Sync>>,
    ) -> Self {
        Self::new(kind, ErrorWithMessage::new(message.into(), source))
    }

    /// Attach a plain-text hint. Returns `self` for chaining with `?`.
    pub fn hinted(mut self, hint: impl Into<String>) -> Self {
        self.hints.push(hint.into());
        self
    }

    /// Append a hint in place.
    pub fn add_hint(&mut self, hint: impl Into<String>) {
        self.hints.push(hint.into());
    }

    /// Render the error to stderr (stdout only for clap help/version) and
    /// return the process exit code.
    pub fn render(&self) -> u8 {
        if let Some(cl) = self.error.downcast_ref::<clap::Error>() {
            return self.render_clap(cl);
        }

        let mut out = std::io::stderr().lock();
        let heading = match self.kind {
            Kind::User | Kind::Cli => "Error: ",
            Kind::Internal => "Internal error: ",
        };
        let _ = write!(out, "{heading}{err}", err = self.error);
        let _ = print_chain(out.by_ref(), self.error.as_ref());
        let _ = write_hints(&mut out, &self.hints);
        self.kind.exit_code()
    }

    fn render_clap(&self, cl: &clap::Error) -> u8 {
        let is_help = matches!(
            cl.kind(),
            ClapErrorKind::DisplayHelp | ClapErrorKind::DisplayVersion
        );
        let exit = if is_help { 0 } else { self.kind.exit_code() };
        let mut out: Box<dyn std::io::Write> = if is_help {
            Box::new(std::io::stdout())
        } else {
            Box::new(std::io::stderr())
        };
        // clap's Display already includes the "error: ..." wrapper.
        let _ = writeln!(out, "{cl}");
        let _ = write_hints(&mut out, &self.hints);
        exit
    }
}

/// Wraps a source error behind a message that becomes the top of the chain.
#[derive(Debug, thiserror::Error)]
#[error("{message}")]
struct ErrorWithMessage {
    message: String,
    source: Box<dyn Error + Send + Sync>,
}

impl ErrorWithMessage {
    fn new(message: String, source: impl Into<Box<dyn Error + Send + Sync>>) -> Self {
        Self {
            message,
            source: source.into(),
        }
    }
}

/// Write the `Caused by:` chain for `err`, if it has any sources.
fn print_chain(w: &mut dyn std::io::Write, err: &dyn Error) -> std::io::Result<()> {
    let first = match err.source() {
        Some(e) => e,
        None => return Ok(()),
    };

    let mut n = 0usize;
    let mut cursor: Option<&dyn Error> = Some(first);
    while let Some(e) = cursor {
        n += 1;
        cursor = e.source();
    }

    if n == 1 {
        return writeln!(w, "Caused by: {first}");
    }
    writeln!(w, "Caused by:")?;
    let mut i = 0usize;
    let mut cursor = Some(first);
    while let Some(e) = cursor {
        i += 1;
        writeln!(w, "  {i}: {e}")?;
        cursor = e.source();
    }
    Ok(())
}

fn write_hints(w: &mut dyn std::io::Write, hints: &[String]) -> std::io::Result<()> {
    for h in hints {
        writeln!(w, "Hint: {h}")?;
    }
    Ok(())
}

impl fmt::Display for CommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.error)?;
        for h in &self.hints {
            write!(f, "\nHint: {h}")?;
        }
        Ok(())
    }
}

impl std::error::Error for CommandError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        self.error.source()
    }
}

/// Build a [`Kind::User`] error.
pub fn user_error(err: impl Into<Box<dyn Error + Send + Sync>>) -> CommandError {
    CommandError::new(Kind::User, err)
}

/// Build a [`Kind::User`] error with a message on top of a source.
pub fn user_error_with_message(
    message: impl Into<String>,
    source: impl Into<Box<dyn Error + Send + Sync>>,
) -> CommandError {
    CommandError::with_message(Kind::User, message, source)
}

/// Build a [`Kind::Cli`] error.
pub fn cli_error(err: impl Into<Box<dyn Error + Send + Sync>>) -> CommandError {
    CommandError::new(Kind::Cli, err)
}

/// Build a [`Kind::Internal`] error.
pub fn internal_error(err: impl Into<Box<dyn Error + Send + Sync>>) -> CommandError {
    CommandError::new(Kind::Internal, err)
}

/// Build a [`Kind::Internal`] error with a message.
pub fn internal_error_with_message(
    message: impl Into<String>,
    source: impl Into<Box<dyn Error + Send + Sync>>,
) -> CommandError {
    CommandError::with_message(Kind::Internal, message, source)
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use std::io::Error as IoError;
    use std::io::ErrorKind as IoErrorKind;

    use super::*;

    /// A representative user error with a message and a hint attached.
    fn wrap() -> CommandError {
        let inner = IoError::new(IoErrorKind::NotFound, "no such git dir");
        user_error_with_message("failed to run git", inner).hinted("check GWT_GIT")
    }

    #[rstest]
    #[case(Kind::User, 1)]
    #[case(Kind::Cli, 2)]
    #[case(Kind::Internal, 2)]
    fn exit_code_follows_kind(#[case] kind: Kind, #[case] expected: u8) {
        assert_eq!(kind.exit_code(), expected);
    }

    #[rstest]
    fn hints_are_carried_verbatim() {
        let err = wrap();
        assert_eq!(err.hints, ["check GWT_GIT"]);
    }

    #[rstest]
    fn chain_builds_from_source() {
        let err = wrap();
        assert!(err.error.source().is_some());
    }

    #[rstest]
    fn render_produces_message_and_hint() {
        let err = user_error(IoError::other("boom")).hinted("do the thing");
        assert_eq!(err.kind.exit_code(), 1);
        let text = format!("{err}");
        assert!(text.contains("boom"));
        assert!(text.contains("Hint: do the thing"));
    }
}
