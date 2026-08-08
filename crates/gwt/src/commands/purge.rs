//! `gwt purge` — remove stale `branch.<name>` config sections.
//!
//! The shared repo config keeps a `branch.<name>` section (tracking remote /
//! merge / rebase settings) for every branch that was ever pushed with `-u`
//! or `git checkout -t`. When a branch is deleted through paths that don't
//! clean config (direct ref deletion, old git), the section outlives the
//! branch. This command garbage-collects those sections — and only those:
//! the deadness test is "the *ref* no longer exists", not "no worktree", so
//! idle branches that still exist are never touched.

use crate::error::{CommandError, user_error, user_error_with_message};
use crate::external::{Git, GitError};

/// Remove `branch.<name>` config sections whose branch ref no longer exists.
/// With `dry_run`, only report what would be removed.
pub fn execute(git: &Git, dry_run: bool) -> Result<(), CommandError> {
    let ctx = git.resolve_context().map_err(repo_not_found)?;
    let run_dir = ctx.run_dir();

    let tracked = git.get_tracked_branches(run_dir).map_err(user_error)?;
    let live = git.list_branch_refs(run_dir).map_err(user_error)?;
    let live: std::collections::HashSet<&str> = live.iter().map(String::as_str).collect();
    let dead: Vec<&str> = tracked
        .iter()
        .map(String::as_str)
        .filter(|b| !live.contains(b))
        .collect();

    if dead.is_empty() {
        log::info!("No stale branch configuration to purge");
        return Ok(());
    }

    for name in dead {
        if dry_run {
            log::info!("Would remove stale config section: branch.{name}");
            continue;
        }
        match git.remove_branch_config(run_dir, name) {
            Ok(()) => log::info!("Removed stale config section: branch.{name}"),
            Err(err) => log::warn!("Failed to remove config section branch.{name}: {err}"),
        }
    }
    Ok(())
}

/// The error surface when no repository or gwt workspace is found around cwd.
fn repo_not_found(source: GitError) -> CommandError {
    user_error_with_message(
        "not inside a git worktree or a gwt workspace",
        source,
    )
    .hinted("run `gwt purge` from inside a worktree, or from a workspace root that contains a `.bare` repo")
}
