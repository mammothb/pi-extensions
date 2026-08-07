//! `gwt add` — create a worktree on a new branch.

use std::path::{Path, PathBuf};

use crate::error::{CommandError, user_error, user_error_with_message};
use crate::external::{Git, GitError};

/// Create a worktree at `path` (relative to the repo root when not absolute)
/// on a new branch `branch`, at `commit` when given.
pub fn execute(
    git: &Git,
    path: &Path,
    branch: &str,
    commit: Option<&str>,
) -> Result<(), CommandError> {
    let root = resolve_root(git).ok_or_else(not_in_worktree)?;
    let target = if path.is_relative() {
        root.join(path)
    } else {
        path.to_path_buf()
    };

    git.add_worktree(branch, &target, commit).map_err(|err| {
        let mut cmd = user_error(err);
        cmd.add_hint(format!(
            "branch `{branch}` may already exist, or the worktree `{}` is already checked out — pick a different `-b`/path",
            target.display()
        ));
        cmd
    })?;

    log::info!(
        "Added worktree at `{}` on branch `{branch}` at {}",
        target.display(),
        commit.unwrap_or("HEAD")
    );
    Ok(())
}

/// The repository root: the worktree toplevel, falling back to the bare
/// repo's git-dir parent. `None` when not inside a repository at all.
fn resolve_root(git: &Git) -> Option<PathBuf> {
    git.show_toplevel()
        .or_else(|_| git.get_worktree_root())
        .ok()
}

fn not_in_worktree() -> CommandError {
    user_error_with_message(
        "not inside a git worktree",
        GitError::Parse {
            command: "rev-parse --show-toplevel (or --absolute-git-dir)".to_owned(),
            message: "neither the worktree toplevel nor the bare repo root could be resolved"
                .to_owned(),
        },
    )
    .hinted("run `gwt add` from inside a git worktree")
}
