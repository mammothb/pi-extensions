use std::{
    io::{BufRead, BufReader},
    path::Path,
};

use anyhow::Result;
use fs_err::File;
use log::warn;
use serde_json::Value;

/// Read a session JSONL file and deserialize each line into a `Value`.
/// Malformed lines are skipped with a warning (matching TypeScript's
/// `try/catch` in `loadAllMessages`).
pub fn lex(path: &Path) -> Result<Vec<Value>> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let mut values = vec![];

    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<Value>(&line) {
            Ok(v) => values.push(v),
            Err(e) => {
                warn!("skipping malformed line in {path:?}: {e}");
            }
        }
    }
    Ok(values)
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;
    use rstest::{fixture, rstest};
    use tempfile::{TempDir, tempdir};

    #[fixture]
    fn dir() -> TempDir {
        tempdir().unwrap()
    }

    fn write_jsonl(dir: &TempDir, name: &str, lines: &[&str]) -> std::path::PathBuf {
        let path = dir.path().join(name);
        let mut f = fs_err::File::create(&path).unwrap();
        for line in lines {
            writeln!(f, "{line}").unwrap();
        }
        path
    }

    #[rstest]
    fn lex_empty_file_returns_empty(dir: TempDir) {
        let path = write_jsonl(&dir, "empty.jsonl", &[]);

        let result = lex(&path).unwrap();

        assert!(result.is_empty());
    }

    #[rstest]
    fn lex_multiple_lines(dir: TempDir) {
        let path = write_jsonl(
            &dir,
            "multi.jsonl",
            &[r#"{"id": 1}"#, r#"{"id": 2}"#, r#"{"id": 3}"#],
        );

        let result = lex(&path).unwrap();

        assert_eq!(result.len(), 3);
        assert_eq!(result[0]["id"], 1);
        assert_eq!(result[1]["id"], 2);
        assert_eq!(result[2]["id"], 3);
    }

    #[rstest]
    fn lex_blank_lines_skipped(dir: TempDir) {
        let path = write_jsonl(
            &dir,
            "blanks.jsonl",
            &["", r#"{"id": 1}"#, "   ", r#"{"id": 2}"#, ""],
        );

        let result = lex(&path).unwrap();

        assert_eq!(result.len(), 2);
    }

    #[rstest]
    fn lex_malformed_line_skipped(dir: TempDir) {
        let path = write_jsonl(
            &dir,
            "partial.jsonl",
            &[r#"{"id": 1}"#, "not valid json", r#"{"id": 3}"#],
        );

        let result = lex(&path).unwrap();

        assert_eq!(result.len(), 2);
        assert_eq!(result[0]["id"], 1);
        assert_eq!(result[1]["id"], 3);
    }

    #[rstest]
    fn lex_nested_objects_preserved(dir: TempDir) {
        let path = write_jsonl(
            &dir,
            "nested.jsonl",
            &[r#"{"type":"message","message":{"role":"user","content":"hello"}}"#],
        );

        let result = lex(&path).unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0]["type"], "message");
        assert_eq!(result[0]["message"]["role"], "user");
        assert_eq!(result[0]["message"]["content"], "hello");
    }

    #[rstest]
    fn lex_large_line_handled(dir: TempDir) {
        let big = "x".repeat(200_000);
        let path = write_jsonl(&dir, "big.jsonl", &[&format!(r#"{{"text": "{big}"}}"#)]);

        let result = lex(&path).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0]["text"].as_str().unwrap().len(), 200_000);
    }
}
