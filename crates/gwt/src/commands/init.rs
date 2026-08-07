//! `gwt init` — scaffold a workspace: a bare clone at `.bare` plus a
//! directory to hold per-feature worktrees.

use std::env::current_dir;
use std::path::{Path, PathBuf};

use crate::error::{CommandError, internal_error, user_error, user_error_with_message};
use crate::external::{Git, GitCloneArgs};

/// Create a workspace directory `[url-name]-workspace` (or `name`) in the
/// current directory, containing a bare clone of `url` at `.bare` whose
/// refspec mirrors all remote branches.
pub fn execute(git: &Git, url: &str, name: Option<&str>) -> Result<(), CommandError> {
    let name = match name {
        Some(name) => name.to_owned(),
        None => {
            let derived = extract_repo_name(url).map_err(|msg| {
                user_error_with_message(format!("invalid repository URL `{url}`"), msg)
            })?;
            format!("{derived}-workspace")
        }
    };

    let cwd = current_dir().map_err(internal_error)?;
    let workspace_dir = cwd.join(&name);
    if workspace_dir.exists() {
        return Err(user_error(format!(
            "directory `{}` already exists",
            workspace_dir.display()
        )));
    }
    fs_err::create_dir_all(&workspace_dir).map_err(internal_error)?;

    let repo_dir = clone_repository(git, url, &workspace_dir)?;
    log::info!(
        "Initialized workspace at `{}` (bare repo `{}`)",
        workspace_dir.display(),
        repo_dir.display()
    );
    Ok(())
}

/// Bare-clone `url` into `workspace_dir/.bare`.
fn clone_repository(git: &Git, url: &str, workspace_dir: &Path) -> Result<PathBuf, CommandError> {
    let repo_dir = workspace_dir.join(".bare");
    let args = GitCloneArgs {
        url,
        dir: &repo_dir,
        bare: true,
        config: vec![("remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*")],
    };
    git.clone(&args).map_err(user_error)?;
    Ok(repo_dir)
}

/// The last path (or scp-colon) component of a repo URL, minus a trailing
/// `.git`. Robust to `https://`, `ssh://`, scp-style `git@host:user/repo`.
fn extract_repo_name(url: &str) -> Result<String, &'static str> {
    let url = url.trim();
    let tail = url.rsplit(':').next().unwrap_or(url); // scp form has no slash
    let tail = tail.rsplit('/').next().unwrap_or(tail); // basename
    let name = tail.strip_suffix(".git").unwrap_or(tail);
    if name.is_empty() {
        Err("empty repository name")
    } else {
        Ok(name.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    #[case("https://github.com/user/repo-name.git", "repo-name")]
    #[case("ssh://git@github.com:2222/user/repo-name", "repo-name")]
    #[case("git@github.com:user/repo-name.git", "repo-name")]
    #[case("../../local-repo", "local-repo")]
    #[case("https://github.com/user/repo-name", "repo-name")]
    fn extract_repo_name_handles_common_url_shapes(#[case] url: &str, #[case] expected: &str) {
        assert_eq!(extract_repo_name(url).unwrap(), expected);
    }

    #[rstest]
    #[case("")]
    #[case("https://github.com/user/")]
    #[case("    ")]
    fn extract_repo_name_rejects_empty(#[case] url: &str) {
        assert!(extract_repo_name(url).is_err());
    }
}
