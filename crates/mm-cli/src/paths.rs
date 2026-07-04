use std::path::{Path, PathBuf};

use anyhow::Result;
use glob::glob;
use itertools::Itertools;
use log::{error, warn};

pub fn create_output_dir(path: &Path, output_dir: Option<&Path>) -> Result<PathBuf> {
    let fallback = fs_err::canonicalize(path)
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."));
    let output_dir = output_dir.unwrap_or(&fallback);
    fs_err::create_dir_all(output_dir)?;
    Ok(output_dir.to_path_buf())
}

pub fn expand_paths(paths: &[String]) -> Vec<PathBuf> {
    let mut files = vec![];
    for raw in paths {
        let expanded_tilded = shellexpand::tilde(raw);
        match glob(expanded_tilded.as_ref()) {
            Ok(expanded) => {
                let mut matched: Vec<_> = expanded.filter_map(Result::ok).collect();
                if matched.is_empty() {
                    warn!("no files matched glob '{raw}'");
                    files.push(PathBuf::from(raw));
                } else {
                    matched.sort_by_key(|p| fs_err::metadata(p).and_then(|m| m.modified()).ok());
                    files.extend(matched);
                }
            }
            Err(e) => {
                error!("invalid glob pattern '{raw}': {e}");
                files.push(PathBuf::from(raw));
            }
        }
    }
    files.into_iter().unique().collect()
}

#[cfg(test)]
mod tests {
    use std::{
        path::{Path, PathBuf},
        thread::sleep,
        time::Duration,
    };

    use super::*;
    use rstest::{fixture, rstest};
    use tempfile::{TempDir, tempdir};

    #[fixture]
    fn dir() -> TempDir {
        tempdir().unwrap()
    }

    /// Build an absolute glob pattern rooted in `dir`.
    fn glob_in(dir: &TempDir, pat: &str) -> String {
        dir.path().join(pat).to_string_lossy().into_owned()
    }

    fn touch(path: &Path, content: &str) {
        fs_err::create_dir_all(path.parent().unwrap()).unwrap();
        fs_err::write(path, content).unwrap();
    }

    // =======================
    // create_output_dir tests
    // =======================
    #[rstest]
    fn provided_output_dir_is_created(dir: TempDir) {
        let output = dir.path().join("out");

        let result = create_output_dir(Path::new("unused"), Some(&output)).unwrap();
        assert_eq!(result, output);
        assert!(output.exists());
    }

    #[rstest]
    fn fallback_derives_from_parent(dir: TempDir) {
        let input = dir.path().join("sub/input.jsonl");
        touch(&input, "");

        let result = create_output_dir(&input, None).unwrap();

        let resolved = fs_err::canonicalize(&input).unwrap();
        assert_eq!(result, resolved.parent().unwrap());
    }

    #[rstest]
    fn fallback_when_canonicalize_fails(dir: TempDir) {
        let nonexistent = dir.path().join("does_not_exist.jsonl");

        let result = create_output_dir(&nonexistent, None).unwrap();

        assert_eq!(result, PathBuf::from("."));
    }

    #[rstest]
    fn already_exists_is_idempotent(dir: TempDir) {
        let output = dir.path().join("out");
        fs_err::create_dir_all(&output).unwrap();

        let result = create_output_dir(Path::new("unused"), Some(&output)).unwrap();

        assert_eq!(result, output);
    }

    #[rstest]
    fn creates_intermediate_dirs(dir: TempDir) {
        let output = dir.path().join("a/b/c");

        let result = create_output_dir(Path::new("unused"), Some(&output)).unwrap();
        assert_eq!(result, output);
        assert!(output.exists());
        assert!(dir.path().join("a").exists());
        assert!(dir.path().join("a/b").exists());
    }

    // ==================
    // expand_paths tests
    // ==================
    #[rstest]
    fn empty_paths_returns_empty() {
        assert_eq!(expand_paths(&[]), Vec::<PathBuf>::new());
    }

    #[rstest]
    fn single_pattern_matches_flat(dir: TempDir) {
        let file_a = dir.path().join("a.rs");
        let file_b = dir.path().join("b.rs");
        touch(&file_a, "a");
        touch(&file_b, "b");
        touch(&dir.path().join("c.md"), "c");

        let result = expand_paths(&[glob_in(&dir, "*.rs")]);

        assert_eq!(result.len(), 2);
        assert!(result.contains(&file_a));
        assert!(result.contains(&file_b));
    }

    #[rstest]
    fn pattern_without_match_returns_input(dir: TempDir) {
        touch(&dir.path().join("c.md"), "c");

        let pat = "*.rs";
        let result = expand_paths(&[glob_in(&dir, pat)]);

        assert_eq!(result.len(), 1);
        assert_eq!(result[0], PathBuf::from(glob_in(&dir, pat)));
    }

    #[rstest]
    fn multiple_distinct_patterns(dir: TempDir) {
        let a = dir.path().join("a.rs");
        let b = dir.path().join("b.rs");
        let c = dir.path().join("c.md");
        touch(&a, "a");
        touch(&b, "b");
        touch(&c, "c");
        touch(&dir.path().join("d.py"), "d");

        let result = expand_paths(&[glob_in(&dir, "*.rs"), glob_in(&dir, "*.md")]);

        assert_eq!(result.len(), 3);
        assert!(result.contains(&a));
        assert!(result.contains(&b));
        assert!(result.contains(&c));
    }

    #[rstest]
    fn overlapping_patterns_dedup(dir: TempDir) {
        let a = dir.path().join("a.rs");
        let b = dir.path().join("b.rs");
        touch(&a, "a");
        touch(&b, "b");

        let result = expand_paths(&[glob_in(&dir, "*.rs"), glob_in(&dir, "a.rs")]);

        assert_eq!(result.len(), 2);
        assert!(result.contains(&a));
        assert!(result.contains(&b));
    }

    #[rstest]
    fn mixed_success_and_no_match(dir: TempDir) {
        let a = dir.path().join("a.rs");
        touch(&a, "a");

        let missing = glob_in(&dir, "*.jsonl");
        let result = expand_paths(&[glob_in(&dir, "*.rs"), missing.clone()]);

        assert_eq!(result.len(), 2);
        assert!(result.contains(&a));
        assert!(result.contains(&PathBuf::from(&missing)));
    }

    #[rstest]
    fn invalid_pattern_returns_input(dir: TempDir) {
        let pat = glob_in(&dir, "[unclosed");
        let result = expand_paths(std::slice::from_ref(&pat));

        // pattern error printed to stderr, input returned as-is
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], PathBuf::from(&pat));
    }

    #[rstest]
    fn subdirectory_pattern(dir: TempDir) {
        let x = dir.path().join("sub/x.rs");
        let y = dir.path().join("sub/y.rs");
        touch(&x, "x");
        touch(&y, "y");
        touch(&dir.path().join("z.rs"), "z");

        let result = expand_paths(&[glob_in(&dir, "sub/*.rs")]);

        assert_eq!(result.len(), 2);
        assert!(result.contains(&x));
        assert!(result.contains(&y));
    }

    #[rstest]
    fn recursive_pattern(dir: TempDir) {
        let a = dir.path().join("a.rs");
        let b = dir.path().join("sub/b.rs");
        let c = dir.path().join("sub/deep/c.rs");
        touch(&a, "a");
        touch(&b, "b");
        touch(&c, "c");
        touch(&dir.path().join("d.md"), "d");

        let result = expand_paths(&[glob_in(&dir, "**/*.rs")]);

        assert_eq!(result.len(), 3);
        assert!(result.contains(&a));
        assert!(result.contains(&b));
        assert!(result.contains(&c));
    }

    #[rstest]
    fn recursive_pattern_without_match_returns_input(dir: TempDir) {
        touch(&dir.path().join("a.md"), "a");

        let pat = glob_in(&dir, "**/*.rs");
        let result = expand_paths(std::slice::from_ref(&pat));

        assert_eq!(result.len(), 1);
        assert_eq!(result[0], PathBuf::from(&pat));
    }

    #[rstest]
    fn literal_path_exists(dir: TempDir) {
        let file = dir.path().join("real.txt");
        touch(&file, "content");

        let result = expand_paths(&[file.to_string_lossy().into_owned()]);

        assert_eq!(result.len(), 1);
        assert_eq!(result[0], file);
    }

    #[rstest]
    fn literal_path_missing_returns_input(dir: TempDir) {
        let missing = dir.path().join("nope.txt");
        let pat = missing.to_string_lossy().into_owned();
        let result = expand_paths(std::slice::from_ref(&pat));

        assert_eq!(result.len(), 1);
        assert_eq!(result[0], PathBuf::from(&pat));
    }

    #[rstest]
    fn files_sorted_by_mtime_ascending(dir: TempDir) {
        let older = dir.path().join("older.rs");
        let newer = dir.path().join("newer.rs");
        touch(&older, "old");
        sleep(Duration::from_secs(1));
        touch(&newer, "new");

        let result = expand_paths(&[glob_in(&dir, "*.rs")]);

        assert_eq!(result.len(), 2);
        // older first (ascending mtime)
        assert_eq!(result[0], older);
        assert_eq!(result[1], newer);
    }

    #[rstest]
    fn mixed_with_invalid_glob(dir: TempDir) {
        let a = dir.path().join("a.rs");
        touch(&a, "a");

        let bad = glob_in(&dir, "[bad");
        let result = expand_paths(&[glob_in(&dir, "*.rs"), bad.clone()]);
        // a.rs from *.rs, plus the invalid pattern preserved
        assert_eq!(result.len(), 2);
        assert!(result.contains(&a));
        assert!(result.contains(&PathBuf::from(&bad)));
    }
}
