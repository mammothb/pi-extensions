//! Pure parsers for `git ... --porcelain` output.
//!
//! Functions here are `&str -> struct` — no git calls — so each parser is
//! unit-testable against captured porcelain without spawning anything.

use std::path::{Path, PathBuf};

/// One entry from `git worktree list --porcelain`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Worktree {
    /// Absolute path to the worktree's top-level directory.
    pub path: PathBuf,
    /// Whether the worktree is the bare repository itself.
    pub bare: bool,
    /// Commit the worktree is checked out (HEAD), when the line is present.
    pub head: Option<String>,
    /// Branch checked out, with the `refs/heads/` prefix stripped.
    pub branch: Option<String>,
}

/// All worktrees of a repository; the main worktree is always first.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Worktrees {
    pub list: Vec<Worktree>,
}

impl Worktrees {
    /// The worktree checked out at `path`, if any.
    pub fn by_path(&self, path: &Path) -> Option<&Worktree> {
        self.list.iter().find(|w| w.path == path)
    }

    /// Whether any worktree has a branch named `name`.
    pub fn has_branch(&self, name: &str) -> bool {
        self.list.iter().any(|w| w.branch.as_deref() == Some(name))
    }

    /// The main (first, non-bare) worktree.
    pub fn main(&self) -> Option<&Worktree> {
        self.list.first()
    }
}

/// Parse `git worktree list --porcelain` output.
///
/// Format: blank-line-delimited blocks of `key value` lines — `worktree
/// <path>` always first, then optional `bare`, `HEAD <oid>`, `branch
/// refs/heads/x` / `detached`. Returns a `String` message on malformed
/// output so the caller can attach command context.
pub fn parse_worktrees(output: &str) -> Result<Worktrees, String> {
    let mut list = Vec::new();
    for block in output.split("\n\n") {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }
        let mut path = None;
        let mut bare = false;
        let mut head = None;
        let mut branch = None;
        for line in block.lines() {
            if let Some(p) = line.strip_prefix("worktree ") {
                path = Some(PathBuf::from(p));
            } else if let Some(oid) = line.strip_prefix("HEAD ") {
                head = Some(oid.to_owned());
            } else if let Some(refname) = line.strip_prefix("branch ") {
                branch = Some(strip_heads_prefix(refname).to_owned());
            } else if line == "bare" {
                bare = true;
            }
            // "detached" and "lock ..." lines are informational; skip.
        }
        let path = path.ok_or_else(|| format!("worktree block missing path: {block:?}"))?;
        list.push(Worktree {
            path,
            bare,
            head,
            branch,
        });
    }
    Ok(Worktrees { list })
}

fn strip_heads_prefix(refname: &str) -> &str {
    refname.strip_prefix("refs/heads/").unwrap_or(refname)
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    const PORCELAIN: &str = "worktree /check/main\nHEAD abc123\nbranch refs/heads/master\n\nworktree /check/other\nHEAD def456\ndetached\n\nworktree /check/bare\nbare\n";

    #[rstest]
    fn parses_blocks_in_order() {
        let ws = parse_worktrees(PORCELAIN).unwrap();
        let paths: Vec<_> = ws.list.iter().map(|w| w.path.as_path()).collect();
        assert_eq!(
            paths,
            [
                Path::new("/check/main"),
                Path::new("/check/other"),
                Path::new("/check/bare"),
            ]
        );
    }

    #[rstest]
    fn parses_fields_and_strips_ref_prefix() {
        let ws = parse_worktrees(PORCELAIN).unwrap();
        let main = &ws.list[0];
        assert!(!main.bare);
        assert_eq!(main.branch.as_deref(), Some("master"));
        assert_eq!(main.head.as_deref(), Some("abc123"));

        let detached = &ws.list[1];
        assert!(!detached.bare);
        assert_eq!(detached.branch, None); // `detached` → no branch

        let bare = &ws.list[2];
        assert!(bare.bare);
    }

    #[rstest]
    fn empty_and_blank_blocks_produce_empty_list() {
        assert_eq!(parse_worktrees("").unwrap(), Worktrees::default());
        assert_eq!(parse_worktrees("\n\n\n").unwrap(), Worktrees::default());
    }

    #[rstest]
    fn missing_path_is_an_error() {
        let err = parse_worktrees("HEAD abc123\nbranch refs/heads/x").unwrap_err();
        assert!(err.contains("missing path"));
    }

    #[rstest]
    fn lookup_helpers() {
        let ws = parse_worktrees(PORCELAIN).unwrap();
        assert!(ws.has_branch("master"));
        assert!(!ws.has_branch("nope"));
        assert!(ws.by_path(Path::new("/check/other")).is_some());
        assert_eq!(ws.by_path(Path::new("/nope")), None);
        assert_eq!(ws.main().unwrap().path, PathBuf::from("/check/main"));
    }
}
