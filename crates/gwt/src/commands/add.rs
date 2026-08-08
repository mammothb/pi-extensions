//! `gwt add` — create a worktree on a new branch.

use std::path::{Path, PathBuf};

use crate::error::{CommandError, user_error, user_error_with_message};
use crate::external::{Git, GitError, RepoContext};

/// Create a worktree at `path` (relative to the resolved repository base when
/// not absolute) on a new branch `branch`, at `commit` when given.
pub fn execute(
    git: &Git,
    path: &Path,
    branch: &str,
    commit: Option<&str>,
) -> Result<(), CommandError> {
    let ctx = git.resolve_context().map_err(repo_not_found)?;
    let target = resolve_target(&ctx, path);

    git.add_worktree(ctx.run_dir(), branch, &target, commit)
        .map_err(|err| {
            let mut cmd = user_error(err);
            cmd.add_hint(format!(
                "path `{}` is already in use or branch `{branch}` already exists — to work there, cd into the existing worktree and run `git checkout -b {branch}`, or use a different path",
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

/// Resolve a path the user gave relative to the repository base; absolute
/// paths pass through unchanged.
fn resolve_target(ctx: &RepoContext, path: &Path) -> PathBuf {
    if path.is_relative() {
        ctx.base().join(path)
    } else {
        path.to_path_buf()
    }
}

/// The error surface when no repository or gwt workspace is found around cwd.
fn repo_not_found(source: GitError) -> CommandError {
    user_error_with_message(
        "not inside a git worktree or a gwt workspace",
        source,
    )
    .hinted("run `gwt add` from inside a worktree, or from a workspace root that contains a `.bare` repo")
}
