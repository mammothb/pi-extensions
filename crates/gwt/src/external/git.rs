//! Hard boundary around the `git` executable.
//!
//! Every git invocation funnels through [`Git::run`], which applies
//! deterministic environment hygiene — locale pinned to C, pager disabled,
//! object replacement disabled, stdin closed — so that parsing and error
//! classification never depend on the caller's environment. Errors carry
//! enough context to reproduce the failed command by hand; see [`GitError`].

use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

use crate::external::parse::{self, Worktrees};

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

    /// Clone a repository (optionally `--bare`) into `dir`, applying
    /// `--config`-style settings.
    pub fn clone(&self, args: &GitCloneArgs) -> Result<(), GitError> {
        let args = args.to_args()?;
        self.run(&args)?;
        Ok(())
    }

    /// Resolve the shared repository root: the directory that contains the
    /// repo's common git dir. For a plain repo that's the toplevel
    /// (`…/<root>/.git` → `<root>`); for a `.bare` workspace it's the
    /// workspace dir (`…/<workspace>/.bare` → `<workspace>`). Works from any
    /// worktree, and from inside the bare dir itself.
    pub fn get_workspace_root(&self) -> Result<PathBuf, GitError> {
        let output = self.run(&["rev-parse", "--path-format=absolute", "--git-common-dir"])?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let root = PathBuf::from(stdout.trim())
            .parent()
            .ok_or_else(|| GitError::Parse {
                command: "rev-parse --path-format=absolute --git-common-dir".to_owned(),
                message: format!("cannot derive workspace root from {stdout:?}"),
            })?
            .to_owned();
        Ok(root)
    }

    /// List branches that have tracking config (`branch.<name>.merge`) in
    /// the repo config. `dir` is where git should run (the bare repo at a
    /// workspace root, or `None` for cwd). Exits 1 when no entries exist,
    /// which maps to an empty list.
    pub fn get_tracked_branches(&self, dir: Option<&Path>) -> Result<Vec<String>, GitError> {
        let output = match self.run_optional_at(
            dir,
            &[
                "config",
                "get",
                "--all",
                "--show-names",
                "--regexp",
                "^branch.*merge$",
            ],
        )? {
            Some(output) => output,
            None => return Ok(Vec::new()),
        };
        let branches = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| {
                line.split_whitespace()
                    .next()
                    .and_then(|s| s.strip_prefix("branch."))
                    .and_then(|s| s.strip_suffix(".merge"))
                    .map(String::from)
            })
            .collect();
        Ok(branches)
    }

    /// List existing local branch refs (`refs/heads/*` names without the
    /// `refs/heads/` prefix), from `dir` when given.
    pub fn list_branch_refs(&self, dir: Option<&Path>) -> Result<Vec<String>, GitError> {
        let output = self.run_at(
            dir,
            &["for-each-ref", "--format=%(refname:strip=2)", "refs/heads"],
        )?;
        let branches = String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::to_owned)
            .collect();
        Ok(branches)
    }

    /// Remove the `branch.<name>` section from the repo config.
    pub fn remove_branch_config(&self, dir: Option<&Path>, name: &str) -> Result<(), GitError> {
        self.run_at(
            dir,
            &["config", "--remove-section", &format!("branch.{name}")],
        )?;
        Ok(())
    }

    /// Create a worktree at `path` on a new branch `branch`, optionally at
    /// `commit` instead of HEAD. `run_dir` sets the git process's working
    /// directory (the `.bare` repo for workspace-root invocation); `None`
    /// runs from the caller's cwd.
    pub fn add_worktree(
        &self,
        run_dir: Option<&Path>,
        branch: &str,
        path: &Path,
        commit: Option<&str>,
    ) -> Result<(), GitError> {
        let path = path.to_str().ok_or_else(|| GitError::Parse {
            command: format!("worktree add -b {branch} {}", path.display()),
            message: "path is not valid UTF-8".to_owned(),
        })?;
        let mut args = vec!["worktree", "add", "-b", branch, path];
        if let Some(c) = commit {
            args.push(c);
        }
        self.run_at(run_dir, &args)?;
        Ok(())
    }

    /// List the repository's worktrees, main first, via
    /// `git worktree list --porcelain`, from `dir` when given. Fails with a
    /// [`GitError::Parse`] when git produces output we cannot interpret.
    pub fn list_worktrees(&self, dir: Option<&Path>) -> Result<Worktrees, GitError> {
        let output = self.run_at(dir, &["worktree", "list", "--porcelain"])?;
        let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
        self.parse_worktrees_output(&stdout)
    }

    /// Parse porcelain worktree output into the [`Worktrees`] model, mapping
    /// parse failures onto the spawning command for a reproducible error.
    fn parse_worktrees_output(&self, stdout: &str) -> Result<Worktrees, GitError> {
        parse::parse_worktrees(stdout).map_err(|message| GitError::Parse {
            command: format!(
                "{} worktree list --porcelain",
                self.executable_path.display()
            ),
            message,
        })
    }

    /// Resolve where the current directory sits relative to a repository:
    /// inside a worktree, or at a workspace root containing a verified bare
    /// repo (`.bare`).
    pub fn resolve_context(&self) -> Result<RepoContext, GitError> {
        // 1. Inside a repository (worktree, bare dir, or the repo itself):
        //    the shared root decides where relative paths land, so the same
        //    argument means the same thing from anywhere. Git auto-discovers
        //    the common repo from the cwd, so no explicit run dir.
        if let Ok(root) = self.get_workspace_root() {
            return Ok(RepoContext {
                base: root,
                run_dir: None,
            });
        }

        // 2. At a workspace root: a bare repo named `.bare` right under cwd.
        //    Git must be told to run there (the cwd itself is not a repo).
        let cwd = std::env::current_dir().map_err(|e| GitError::Parse {
            command: "current_dir".to_owned(),
            message: e.to_string(),
        })?;
        let bare_dir = cwd.join(".bare");
        if self.is_bare_repo(&bare_dir)? {
            return Ok(RepoContext {
                base: cwd,
                run_dir: Some(bare_dir),
            });
        }

        Err(GitError::Parse {
            command: "resolve context".to_owned(),
            message: "cwd is not inside a git repository or a gwt workspace".to_owned(),
        })
    }

    /// `true` when `dir` is a real git repo with `core.bare=true`. Cheap
    /// markers gate the authoritative check so we don't spawn git when there
    /// is no `.bare` around at all.
    fn is_bare_repo(&self, dir: &Path) -> Result<bool, GitError> {
        if !dir.join("HEAD").is_file() || !dir.join("objects").is_dir() {
            return Ok(false);
        }
        let output = self.run_at(Some(dir), &["rev-parse", "--is-bare-repository"])?;
        Ok(String::from_utf8_lossy(&output.stdout).trim() == "true")
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

    /// Run git with `args` and return the captured output.
    ///
    /// Applies deterministic environment hygiene so git behaves identically
    /// everywhere: locale pinned to C (parseable, English error prefixes),
    /// pager disabled, object replacement disabled, stdin closed.
    fn run(&self, args: &[impl AsRef<str>]) -> Result<Output, GitError> {
        self.run_at(None, args)
    }

    /// Like [`Git::run`], but with the git process's working directory set to
    /// `dir` (e.g. a `.bare` repo). Pass `None` for the caller's cwd.
    fn run_at(&self, dir: Option<&Path>, args: &[impl AsRef<str>]) -> Result<Output, GitError> {
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
        if let Some(dir) = dir {
            cmd.current_dir(dir);
        }

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
        self.run_optional_at(None, args)
    }

    /// Like [`Git::run_optional`], with the process's working directory set
    /// to `dir` (pass `None` for the caller's cwd).
    pub fn run_optional_at(
        &self,
        dir: Option<&Path>,
        args: &[impl AsRef<str>],
    ) -> Result<Option<Output>, GitError> {
        match self.run_at(dir, args) {
            Ok(output) => Ok(Some(output)),
            Err(GitError::NonZeroExit { code: 1, .. }) => Ok(None),
            Err(err) => Err(err),
        }
    }
}

/// Where the current directory sits relative to a repository, and how to
/// invoke git for it.
///
/// `base` is always the workspace root — the directory that holds both the
/// repo's common dir and, for a `.bare` workspace, the worktree slots. So a
/// relative path means the same thing from any invocation site inside the
/// repo. `run_dir` is only set when cwd itself is not a git repository (the
/// bare workspace root), where git must be pointed at the bare repo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoContext {
    /// Workspace root: relative worktree paths resolve here.
    base: PathBuf,
    /// Directory git should run from, or `None` for the caller's cwd.
    run_dir: Option<PathBuf>,
}

impl RepoContext {
    /// Base directory for relative worktree paths — always the workspace
    /// root, regardless of where the command was invoked.
    pub fn base(&self) -> &Path {
        &self.base
    }

    /// Directory git should run from, or `None` for the caller's cwd.
    pub fn run_dir(&self) -> Option<&Path> {
        self.run_dir.as_deref()
    }
}

impl Default for Git {
    fn default() -> Self {
        Self::new()
    }
}

/// Arguments for a `git clone`, constructed separately from execution so the
/// arg-building (incl. the UTF-8 dir check) is unit-testable.
pub struct GitCloneArgs<'a> {
    pub url: &'a str,
    pub dir: &'a Path,
    pub bare: bool,
    pub config: Vec<(&'a str, &'a str)>,
}

impl GitCloneArgs<'_> {
    /// Build the `git clone ...` argument list.
    pub fn to_args(&self) -> Result<Vec<String>, GitError> {
        let dir = self.dir.to_str().ok_or_else(|| GitError::Parse {
            command: format!("clone {} into {}", self.url, self.dir.display()),
            message: "destination path is not valid UTF-8".to_owned(),
        })?;

        let mut args = vec!["clone".to_owned()];
        if self.bare {
            args.push("--bare".to_owned());
        }
        for (key, value) in &self.config {
            args.push("--config".to_owned());
            args.push(format!("{key}={value}"));
        }
        args.push("--".to_owned());
        args.push(self.url.to_owned());
        args.push(dir.to_owned());
        Ok(args)
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

    #[rstest]
    fn clone_args_are_bare_with_fetch_config() {
        let args = GitCloneArgs {
            url: "https://x/y.git",
            dir: Path::new("/ws/.bare"),
            bare: true,
            config: vec![("remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*")],
        };
        assert_eq!(
            args.to_args().unwrap(),
            [
                "clone",
                "--bare",
                "--config",
                "remote.origin.fetch=+refs/heads/*:refs/remotes/origin/*",
                "--",
                "https://x/y.git",
                "/ws/.bare"
            ]
        );
    }

    #[rstest]
    fn exit_code_is_none_for_non_exit_errors() {
        assert_eq!(error_like_parse().exit_code(), None);
        assert_eq!(git_error_version_too_old().exit_code(), None);
    }

    #[rstest]
    fn default_matches_new() {
        assert_eq!(Git::default().executable_path, Git::new().executable_path);
    }

    #[rstest]
    fn check_version_rejects_unparseable_output() {
        // `true` ignores all args, exits 0, prints nothing: unparseable.
        let git = dummy_git("true");
        assert!(matches!(git.check_version(), Err(GitError::Parse { .. })));
    }

    #[rstest]
    fn workspace_root_parse_requires_path_output() {
        let git = dummy_git("true");
        assert!(matches!(
            git.get_workspace_root(),
            Err(GitError::Parse { .. })
        ));
    }

    #[rstest]
    fn list_worktrees_parses_porcelain_from_dir() {
        let tmp = tempfile::TempDir::new().unwrap();
        let init = std::process::Command::new("git")
            .args(["init", "-q", "-b", "main"])
            .current_dir(tmp.path())
            .status()
            .unwrap();
        assert!(init.success(), "git init failed");

        let git = dummy_git("git");
        let ws = git.list_worktrees(Some(tmp.path())).unwrap();
        assert_eq!(ws.list.len(), 1, "fresh repo has exactly the main worktree");
        assert_eq!(ws.main().unwrap().path, tmp.path());
    }

    #[rstest]
    fn parse_worktrees_output_rejects_garbage_with_command() {
        let git = dummy_git("git");
        let err = git
            .parse_worktrees_output("not porcelain at all")
            .unwrap_err();
        match err {
            GitError::Parse { command, .. } => {
                assert!(command.contains("worktree list --porcelain"), "{command}")
            }
            other => panic!("expected Parse, got {other:?}"),
        }
    }

    #[rstest]
    fn clone_args_reject_non_utf8_dir() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;

        let bad = PathBuf::from(OsString::from_vec(vec![0xff]));
        let args = GitCloneArgs {
            url: "https://x/y.git",
            dir: &bad,
            bare: false,
            config: vec![],
        };
        let err = args.to_args().unwrap_err();
        assert!(matches!(err, GitError::Parse { .. }));
    }

    #[rstest]
    fn add_worktree_rejects_non_utf8_path() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;

        let git = dummy_git("git");
        let bad = PathBuf::from(OsString::from_vec(vec![0xff]));
        assert!(matches!(
            git.add_worktree(None, "feat/x", &bad, None),
            Err(GitError::Parse { .. })
        ));
    }

    #[rstest]
    fn run_optional_treats_exit_1_as_none() {
        // `git config --get` on a missing key exits 1 inside a repository.
        let git = dummy_git("git");
        let out = git
            .run_optional(&["config", "--get", "__gwt.no.such.key"])
            .unwrap();
        assert!(out.is_none());
    }

    #[rstest]
    fn run_optional_propagates_other_exits() {
        // An invalid revision exits 128 (not 1) — must surface as an error.
        let git = dummy_git("git");
        let err = git
            .run_optional_at(None, &["rev-parse", "__gwt_no_such_rev__"])
            .unwrap_err();
        match err {
            GitError::NonZeroExit { code, .. } => assert_ne!(code, 1),
            other => panic!("expected NonZeroExit, got {other:?}"),
        }
    }

    /// A `Git` pinned to `exe` without touching the `GWT_GIT` env var.
    fn dummy_git(exe: &str) -> Git {
        Git {
            executable_path: PathBuf::from(exe),
        }
    }

    fn error_like_parse() -> GitError {
        GitError::Parse {
            command: "git --version".to_owned(),
            message: "unrecognized".to_owned(),
        }
    }

    fn git_error_version_too_old() -> GitError {
        GitError::VersionTooOld {
            current: "2.30.0".to_owned(),
            required: "2.40.0".to_owned(),
        }
    }
}
