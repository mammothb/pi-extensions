use std::collections::HashSet;

use serde_json::Value;

use crate::types::NormalizedBlock;

// ============
// Public types
// ============

#[derive(Debug, PartialEq, Eq)]
pub struct FileActivity {
    pub read: Vec<String>,
    pub modified: Vec<String>,
    pub created: Vec<String>,
}

// ===================
// Tool classification
// ===================
// Tool names covering all supported formats:
//   Pi:                Read, read, Edit, edit, Write, write
//   Claude Code:       Read, Edit, Write, MultiEdit
//   Anthropic API:     read_file, edit_file, write_file, View
const FILE_READ_TOOLS: &[&str] = &["Read", "read", "read_file", "View"];
const FILE_WRITE_TOOLS: &[&str] = &[
    "Edit",
    "edit",
    "Write",
    "write",
    "MultiEdit",
    "edit_file",
    "write_file",
];
const FILE_CREATE_TOOLS: &[&str] = &["Write", "write", "write_file"];

// ==========
// Public API
// ==========

/// Extract file activity classified by operation (read, modified, created)
/// from tool calls in a sequence of normalized blocks.
///
/// Only `ToolCall` blocks are examined. Paths are extracted from `args` via
/// the keys `path`, `file_path`, `filePath`, or `file`. When two or more
/// absolute paths share a common directory prefix of ≥2 segments, that prefix
/// is stripped from all paths. Duplicates are removed and results are sorted.
pub fn extract_files(blocks: &[NormalizedBlock]) -> FileActivity {
    let mut read: HashSet<String> = HashSet::new();
    let mut modified: HashSet<String> = HashSet::new();
    let mut created: HashSet<String> = HashSet::new();

    for b in blocks {
        let (name, args) = match b {
            NormalizedBlock::ToolCall { name, args, .. } => (name.as_str(), args),
            _ => continue,
        };

        let path = match extract_path(args) {
            Some(p) => p,
            None => continue,
        };

        if FILE_READ_TOOLS.contains(&name) {
            read.insert(path.clone());
        }
        if FILE_WRITE_TOOLS.contains(&name) {
            modified.insert(path.clone());
        }
        if FILE_CREATE_TOOLS.contains(&name) {
            created.insert(path);
        }
    }

    // Common-prefix stripping
    let all: Vec<&str> = read
        .iter()
        .chain(modified.iter())
        .chain(created.iter())
        .map(|s| s.as_str())
        .collect();
    let prefix = longest_common_dir_prefix(&all);

    let read_set = trim_paths(&read, &prefix);
    let modified_set = trim_paths(&modified, &prefix);
    let created_set = trim_paths(&created, &prefix);

    // Deterministic sorted output
    let mut read: Vec<String> = read_set.into_iter().collect();
    let mut modified: Vec<String> = modified_set.into_iter().collect();
    let mut created: Vec<String> = created_set.into_iter().collect();
    read.sort();
    modified.sort();
    created.sort();

    FileActivity {
        read,
        modified,
        created,
    }
}

// ===============
// Private helpers
// ===============

/// Extract a file path from tool-call arguments.
/// Checks the keys `path`, `file_path`, `filePath`, `file` (in order).
fn extract_path(args: &Value) -> Option<String> {
    let obj = args.as_object()?;
    for key in &["path", "file_path", "filePath", "file"] {
        if let Some(Value::String(s)) = obj.get(*key)
            && !s.is_empty()
        {
            return Some(s.clone());
        }
    }
    None
}

/// Find the longest common directory prefix among absolute paths.
///
/// Returns an empty string when fewer than 2 absolute paths are present,
/// or when the shared prefix is shorter than 2 segments (e.g. just `/home`
/// is not considered meaningful).
fn longest_common_dir_prefix(paths: &[&str]) -> String {
    let abs: Vec<&str> = paths
        .iter()
        .filter(|p| p.starts_with('/'))
        .copied()
        .collect();
    if abs.len() < 2 {
        return String::new();
    }

    let split: Vec<Vec<&str>> = abs.iter().map(|p| p.split('/').collect()).collect();
    let min_len = split.iter().map(|s| s.len()).min().unwrap_or(0);

    let mut i = 0;
    while i < min_len.saturating_sub(1) {
        let seg = split[0][i];
        if !split.iter().all(|s| s[i] == seg) {
            break;
        }
        i += 1;
    }

    if i < 2 {
        return String::new(); // need at least /a/b depth
    }

    format!("{}/", split[0][..i].join("/"))
}

/// Strip `prefix` from every path in `set` that starts with it.
fn trim_paths(set: &HashSet<String>, prefix: &str) -> HashSet<String> {
    if prefix.is_empty() {
        return set.clone();
    }
    set.iter()
        .map(|p| {
            p.strip_prefix(prefix)
                .map(|s| s.to_string())
                .unwrap_or_else(|| p.clone())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;
    use serde_json::json;

    fn tool_call(name: &str, args: Value, idx: usize) -> NormalizedBlock {
        NormalizedBlock::ToolCall {
            name: name.into(),
            args,
            source_index: idx,
        }
    }

    fn user_block(text: &str, idx: usize) -> NormalizedBlock {
        NormalizedBlock::User {
            text: text.into(),
            source_index: idx,
        }
    }

    // ============
    // extract_path
    // ============

    #[rstest]
    #[case(json!({"path": "src/main.rs"}), "src/main.rs")]
    #[case(json!({"file_path": "src/lib.rs"}), "src/lib.rs")]
    #[case(json!({"filePath": "src/mod.rs"}), "src/mod.rs")]
    #[case(json!({"file": "src/util.rs"}), "src/util.rs")]
    fn path_key_extraction(#[case] args: Value, #[case] expected: &str) {
        assert_eq!(extract_path(&args).as_deref(), Some(expected));
    }

    #[rstest]
    fn extract_path_returns_none_for_unknown_keys() {
        assert_eq!(extract_path(&json!({"query": "foo"})), None);
    }

    #[rstest]
    fn extract_path_returns_none_for_empty_string() {
        assert_eq!(extract_path(&json!({"file_path": ""})), None);
    }

    #[rstest]
    fn extract_path_returns_none_for_non_object() {
        assert_eq!(extract_path(&Value::String("nope".into())), None);
    }

    // =========================
    // longest_common_dir_prefix
    // =========================

    #[rstest]
    fn common_prefix_two_absolute_paths() {
        let paths = ["/home/user/project/src/a.rs", "/home/user/project/src/b.rs"];
        assert_eq!(longest_common_dir_prefix(&paths), "/home/user/project/src/");
    }

    #[rstest]
    fn common_prefix_single_path_returns_empty() {
        let paths = ["/home/user/project/src/a.rs"];
        assert_eq!(longest_common_dir_prefix(&paths), "");
    }

    #[rstest]
    fn common_prefix_only_root_shared_returns_empty() {
        // Only root "/" is common → i=1, which is < 2
        let paths = ["/a/foo.rs", "/b/bar.rs"];
        assert_eq!(longest_common_dir_prefix(&paths), "");
    }

    #[rstest]
    fn common_prefix_no_absolute_paths_returns_empty() {
        let paths = ["src/a.rs", "src/b.rs"];
        assert_eq!(longest_common_dir_prefix(&paths), "");
    }

    #[rstest]
    fn common_prefix_divergent_at_root() {
        let paths = ["/a/b/c.txt", "/x/y/z.txt"];
        assert_eq!(longest_common_dir_prefix(&paths), "");
    }

    // =============
    // extract_files
    // =============

    #[rstest]
    fn read_tool_classified_as_read() {
        let blocks = [tool_call("Read", json!({"file_path": "src/main.rs"}), 0)];
        let fa = extract_files(&blocks);
        assert_eq!(fa.read, vec!["src/main.rs"]);
        assert!(fa.modified.is_empty());
        assert!(fa.created.is_empty());
    }

    #[rstest]
    fn edit_tool_classified_as_modified() {
        let blocks = [tool_call("Edit", json!({"file_path": "src/lib.rs"}), 0)];
        let fa = extract_files(&blocks);
        assert_eq!(fa.modified, vec!["src/lib.rs"]);
        assert!(fa.read.is_empty());
        assert!(fa.created.is_empty());
    }

    #[rstest]
    fn write_tool_classified_as_modified_and_created() {
        let blocks = [tool_call("Write", json!({"path": "new.rs"}), 0)];
        let fa = extract_files(&blocks);
        assert_eq!(fa.modified, vec!["new.rs"]);
        assert_eq!(fa.created, vec!["new.rs"]);
        assert!(fa.read.is_empty());
    }

    #[rstest]
    fn multi_edit_claude_code_tool() {
        let blocks = [tool_call(
            "MultiEdit",
            json!({"file_path": "src/main.rs"}),
            0,
        )];
        let fa = extract_files(&blocks);
        assert_eq!(fa.modified, vec!["src/main.rs"]);
        assert!(fa.read.is_empty());
        assert!(fa.created.is_empty());
    }

    #[rstest]
    fn anthropic_api_tools() {
        // read_file, edit_file, write_file — Anthropic API native names
        let blocks = [
            tool_call("read_file", json!({"file_path": "a.rs"}), 0),
            tool_call("edit_file", json!({"file_path": "b.rs"}), 1),
            tool_call("write_file", json!({"file_path": "c.rs"}), 2),
        ];
        let fa = extract_files(&blocks);
        assert_eq!(fa.read, vec!["a.rs"]);
        assert_eq!(fa.modified, vec!["b.rs", "c.rs"]);
        assert_eq!(fa.created, vec!["c.rs"]);
    }

    #[rstest]
    fn view_tool_classified_as_read() {
        let blocks = [tool_call("View", json!({"file_path": "README.md"}), 0)];
        let fa = extract_files(&blocks);
        assert_eq!(fa.read, vec!["README.md"]);
        assert!(fa.modified.is_empty());
    }

    #[rstest]
    fn unknown_tool_ignored() {
        let blocks = [tool_call("Bash", json!({"command": "ls"}), 0)];
        let fa = extract_files(&blocks);
        assert!(fa.read.is_empty());
        assert!(fa.modified.is_empty());
        assert!(fa.created.is_empty());
    }

    #[rstest]
    fn no_file_path_ignored() {
        let blocks = [tool_call("Read", json!({"query": "foo"}), 0)];
        let fa = extract_files(&blocks);
        assert!(fa.read.is_empty());
    }

    #[rstest]
    fn duplicate_paths_deduplicated() {
        let blocks = [
            tool_call("Read", json!({"file_path": "a.rs"}), 0),
            tool_call("Read", json!({"file_path": "a.rs"}), 1),
        ];
        let fa = extract_files(&blocks);
        assert_eq!(fa.read, vec!["a.rs"]);
    }

    #[rstest]
    fn common_prefix_stripped() {
        let blocks = [
            tool_call(
                "Read",
                json!({"file_path": "/home/user/project/src/a.rs"}),
                0,
            ),
            tool_call(
                "Read",
                json!({"file_path": "/home/user/project/src/b.rs"}),
                1,
            ),
        ];
        let fa = extract_files(&blocks);
        // Full common prefix: "/home/user/project/src/" stripped → filenames remain
        assert_eq!(fa.read, vec!["a.rs", "b.rs"]);
    }

    #[rstest]
    fn common_prefix_applied_across_categories() {
        let blocks = [
            tool_call("Read", json!({"file_path": "/proj/src/read.rs"}), 0),
            tool_call("Edit", json!({"file_path": "/proj/src/edit.rs"}), 1),
            tool_call("Write", json!({"file_path": "/proj/src/write.rs"}), 2),
        ];
        let fa = extract_files(&blocks);
        // Full common prefix: "/proj/src/" stripped → filenames remain
        assert_eq!(fa.read, vec!["read.rs"]);
        assert_eq!(fa.modified, vec!["edit.rs", "write.rs"]);
        assert_eq!(fa.created, vec!["write.rs"]);
    }

    #[rstest]
    fn non_tool_call_blocks_ignored() {
        let blocks = [
            user_block("read src/main.rs please", 0),
            tool_call("Read", json!({"file_path": "src/main.rs"}), 1),
        ];
        let fa = extract_files(&blocks);
        assert_eq!(fa.read, vec!["src/main.rs"]);
    }

    #[rstest]
    fn lower_case_tool_names() {
        let blocks = [
            tool_call("read", json!({"file_path": "a.rs"}), 0),
            tool_call("edit", json!({"file_path": "b.rs"}), 1),
            tool_call("write", json!({"file_path": "c.rs"}), 2),
        ];
        let fa = extract_files(&blocks);
        assert_eq!(fa.read, vec!["a.rs"]);
        assert_eq!(fa.modified, vec!["b.rs", "c.rs"]);
        assert_eq!(fa.created, vec!["c.rs"]);
    }

    #[rstest]
    fn results_sorted_alphabetically() {
        let blocks = [
            tool_call("Read", json!({"file_path": "c.rs"}), 0),
            tool_call("Read", json!({"file_path": "a.rs"}), 1),
            tool_call("Read", json!({"file_path": "b.rs"}), 2),
        ];
        let fa = extract_files(&blocks);
        assert_eq!(fa.read, vec!["a.rs", "b.rs", "c.rs"]);
    }

    #[rstest]
    fn empty_blocks_returns_empty() {
        let fa = extract_files(&[]);
        assert!(fa.read.is_empty());
        assert!(fa.modified.is_empty());
        assert!(fa.created.is_empty());
    }
}
