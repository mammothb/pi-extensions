//! Hard boundary around the `git` executable.
//!
//! Every git invocation funnels through [`Git::run`], which applies
//! deterministic environment hygiene — locale pinned to C, pager disabled,
//! object replacement disabled, stdin closed — so that parsing and error
//! classification never depend on the caller's environment. Errors carry
//! enough context to reproduce the failed command by hand; see [`GitError`].

use std::io;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};

/// Minimum supported git version (2.40: `git config get`, modern porcelain).
const MIN_VERSION: (u32, u32, u32) = (2, 40, 0);

/// Errors from the git spawn layer.
#[derive(Debug, thiserror::Error)]
pub enum GitError {
    /// The executable could not be launched. The path is explicit (e.g. from
    /// `GWT_GIT`): missing file, bad permissions, not executable.
    #[error("failed to execute git at `{executable}`: {source}")]
    Spawn {
        executable: String,
        #[source]
        source: io::Error,
    },

    /// The executable could not be launched and was resolved via `PATH`
    /// (bare name, the default `git`): not installed, or PATH is broken.
    #[error("failed to execute `git`: {source} (is git installed and on PATH?)")]
    SpawnInPath {
        #[source]
        source: io::Error,
    },

    /// git ran and exited non-zero. `command` is the full command line as a
    /// repro; `stdout`/`stderr` are the captured streams.
    #[error(
        "`{command}` exited with code {code}\n--- stdout ---\n{stdout}\n--- stderr ---\n{stderr}"
    )]
    NonZeroExit {
        command: String,
        code: i32,
        stdout: String,
        stderr: String,
    },

    /// git produced output we could not parse.
    #[error("could not parse output of `{command}`: {message}")]
    Parse { command: String, message: String },

    /// The installed git is older than [`MIN_VERSION`].
    #[error("git {current} is too old; gwt requires git >= {required}")]
    VersionTooOld { current: String, required: String },
}

impl GitError {
    /// The exit code, when this error came from a non-zero git exit.
    pub fn exit_code(&self) -> Option<i32> {
        match self {
            GitError::NonZeroExit { code, .. } => Some(*code),
            _ => None,
        }
    }
}

/// Spawns `git` and captures its output.
#[derive(Debug)]
pub struct Git {
    executable_path: PathBuf,
}

impl Git {
    /// Create a `Git` bound to the executable named by `GWT_GIT`, or `git`
    /// resolved from `PATH` when unset.
    pub fn new() -> Self {
        let executable = std::env::var("GWT_GIT").unwrap_or_else(|_| "git".to_owned());
        Self {
            executable_path: PathBuf::from(executable),
        }
    }

    /// Run git with `args` and return the captured output.
    ///
    /// Applies deterministic environment hygiene so git behaves identically
    /// everywhere: locale pinned to C (parseable, English error prefixes),
    /// pager disabled, object replacement disabled, stdin closed.
    pub fn run(&self, args: &[impl AsRef<str>]) -> Result<Output, GitError> {
        let args: Vec<&str> = args.iter().map(AsRef::as_ref).collect();
        let command = format!("{} {}", self.executable_path.display(), args.join(" "));
        log::debug!("running {command}");

        let mut cmd = Command::new(&self.executable_path);
        cmd.args(["--no-pager", "--no-replace-objects"])
            .args(&args)
            .env_remove("LC_ALL")
            .env_remove("LANGUAGE")
            .env("LC_MESSAGES", "C")
            .stdin(Stdio::null());

        let output = cmd.output().map_err(|e| self.map_spawn_error(e))?;

        if output.status.success() {
            return Ok(output);
        }
        let code = output.status.code().unwrap_or(128);
        Err(GitError::NonZeroExit {
            command,
            code,
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }

    /// Like [`Git::run`], but treats `exit 1` as a "no" outcome (`None`)
    /// rather than an error. Any other non-zero exit is still an error.
    pub fn run_optional(&self, args: &[impl AsRef<str>]) -> Result<Option<Output>, GitError> {
        match self.run(args) {
            Ok(output) => Ok(Some(output)),
            Err(GitError::NonZeroExit { code: 1, .. }) => Ok(None),
            Err(err) => Err(err),
        }
    }

    /// Assert the installed git is at least [`MIN_VERSION`]; error otherwise.
    pub fn check_version(&self) -> Result<(), GitError> {
        let output = self.run(&["--version"])?;
        let raw = String::from_utf8_lossy(&output.stdout).into_owned();
        let current = parse_version(&raw).ok_or_else(|| GitError::Parse {
            command: format!("{} --version", self.executable_path.display()),
            message: format!("unrecognized version string {raw:?}"),
        })?;
        if current < MIN_VERSION {
            return Err(GitError::VersionTooOld {
                current: format_version(current),
                required: format_version(MIN_VERSION),
            });
        }
        Ok(())
    }

    fn map_spawn_error(&self, source: io::Error) -> GitError {
        // A single path component means a bare name resolved via PATH;
        // anything else is an explicit path and should be reported as such.
        let bare = self.executable_path.components().count() <= 1;
        if bare {
            GitError::SpawnInPath { source }
        } else {
            GitError::Spawn {
                executable: self.executable_path.display().to_string(),
                source,
            }
        }
    }
}

impl Default for Git {
    fn default() -> Self {
        Self::new()
    }
}

/// Parse the version out of `git --version` output.
///
/// Handles `git version 2.40.0` and suffixed forms like `2.40.0.windows.1`.
fn parse_version(output: &str) -> Option<(u32, u32, u32)> {
    let token = output
        .split_whitespace()
        .find(|tok| tok.as_bytes().first().is_some_and(u8::is_ascii_digit))?;
    let mut parts = token.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    Some((major, minor, patch))
}

fn format_version((major, minor, patch): (u32, u32, u32)) -> String {
    format!("{major}.{minor}.{patch}")
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    #[case("git version 2.40.0", Some((2, 40, 0)))]
    #[case("git version 2.39.2 (Apple Git-145)", Some((2, 39, 2)))]
    #[case("git version 2.40.0.windows.1", Some((2, 40, 0)))]
    #[case("", None)]
    #[case("git: unknown option", None)]
    fn parses_version_output(#[case] output: &str, #[case] expected: Option<(u32, u32, u32)>) {
        assert_eq!(parse_version(output), expected);
    }

    #[rstest]
    fn non_zero_exit_display_carries_repro() {
        let err = GitError::NonZeroExit {
            command: "git worktree add -b feat/x /tmp/repo".to_owned(),
            code: 128,
            stdout: String::new(),
            stderr: "fatal: 'feat/x' already exists".to_owned(),
        };
        let text = err.to_string();
        assert!(text.contains("git worktree add -b feat/x /tmp/repo"));
        assert!(text.contains("code 128"));
        assert!(text.contains("already exists"));
        assert_eq!(err.exit_code(), Some(128));
    }

    #[rstest]
    fn bare_name_spawn_failure_is_spawn_in_path() {
        let git = Git {
            executable_path: PathBuf::from("git"),
        };
        let err = git.map_spawn_error(io::Error::new(io::ErrorKind::NotFound, "no such file"));
        assert!(matches!(err, GitError::SpawnInPath { .. }));
    }

    #[rstest]
    fn explicit_path_spawn_failure_is_spawn() {
        let git = Git {
            executable_path: PathBuf::from("/opt/gwt/git"),
        };
        let err = git.map_spawn_error(io::Error::new(io::ErrorKind::NotFound, "no such file"));
        assert!(matches!(err, GitError::Spawn { .. }));
    }
}
