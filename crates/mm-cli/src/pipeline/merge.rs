//! Merge a previous compaction summary with a freshly compiled summary.
//!
//! Handles section-level dedup, file-category merging, and brief transcript
//! concatenation.

use std::collections::{HashMap, HashSet};

/// Section headers in the order they appear in formatted summaries.
const HEADER_NAMES: &[&str] = &[
    "Session Goal",
    "Files & Changes",
    "Commits",
    "User Preferences",
];

/// Separator between header sections and the brief transcript.
const SECTION_SEPARATOR: &str = "\n\n---\n\n";

// ==========
// Public API
// ==========

/// Merge a previous summary (from a prior compaction) with the freshly
/// compiled output. Returns the merged summary string.
///
/// RECALL_NOTE stripping is handled by the TS shim before sending
/// `previousSummary` — Rust never sees it.
pub fn merge(previous_summary: &str, fresh: &str) -> String {
    if previous_summary.is_empty() {
        return fresh.to_string();
    }
    merge_previous(previous_summary, fresh)
}

/// Extract a named section from summary text. Returns the full section
/// including the `[Header]` line, or empty if the section is absent.
fn section_of<'a>(text: &'a str, header: &str) -> &'a str {
    let tag = format!("[{header}]");
    let start = match text.find(&tag) {
        Some(s) => s,
        None => return "",
    };
    let after = &text[start..];

    // Find end boundary: next known header, or SECTION_SEPARATOR, or end of text
    let next_header = HEADER_NAMES
        .iter()
        .filter(|h| **h != header)
        .filter_map(|h| after.find(&format!("[{h}]")))
        .min();

    let next_sep = after.find(SECTION_SEPARATOR);

    let end = match (next_header, next_sep) {
        (Some(h), Some(s)) => h.min(s),
        (Some(h), None) => h,
        (None, Some(s)) => s,
        (None, None) => after.len(),
    };

    after[..end].trim()
}

/// Extract just the body of a section (without the `[Header]` line).
fn section_body(section: &str) -> &str {
    section
        .find('\n')
        .map(|idx| section[idx + 1..].trim())
        .unwrap_or("")
}

/// Extract the brief transcript portion (everything after the separator).
fn brief_of(text: &str) -> &str {
    text.find(SECTION_SEPARATOR)
        .map(|idx| text[idx + SECTION_SEPARATOR.len()..].trim())
        .unwrap_or("")
}

// ===========================
// Section-level merge helpers
// ===========================

/// Merge a single header section from previous and fresh summaries.
fn merge_header_section(header: &str, prev: &str, fresh: &str) -> String {
    if prev.is_empty() {
        return fresh.to_string();
    }
    if fresh.is_empty() {
        return prev.to_string();
    }

    if header == "Files & Changes" {
        return merge_file_lines(prev, fresh);
    }

    // Session Goal, Commits, User Preferences: line-level dedup, capped
    let prev_lines = parse_section_lines(section_body(prev));
    let fresh_lines = parse_section_lines(section_body(fresh));

    let mut combined: Vec<&str> = Vec::new();
    for l in &prev_lines {
        if !combined.contains(l) {
            combined.push(l);
        }
    }
    for l in &fresh_lines {
        if !combined.contains(l) {
            combined.push(l);
        }
    }

    let cap: usize = match header {
        "Session Goal" => 8,
        "Commits" => 8,
        _ => 15,
    };

    let capped: Vec<&str> = if combined.len() > cap {
        combined[combined.len() - cap..].to_vec()
    } else {
        combined
    };

    if capped.is_empty() {
        return String::new();
    }

    format!(
        "[{header}]\n{}",
        capped
            .iter()
            .map(|l| format!("- {l}"))
            .collect::<Vec<_>>()
            .join("\n")
    )
}

/// Filter and extract content lines from a section body.
/// Keeps only lines starting with "- " and excluding skill tags.
fn parse_section_lines(text: &str) -> Vec<&str> {
    text.lines()
        .filter(|l| l.starts_with("- "))
        .filter(|l| !l.contains("<skill") && !l.contains("</skill"))
        .map(|l| l.trim_start_matches("- "))
        .collect()
}

/// Merge Files & Changes sections by category (Modified, Created, Read),
/// deduplicating paths across compactions.
///
/// `prev` and `fresh` are full sections including the `[Files & Changes]` header.
fn merge_file_lines(prev: &str, fresh: &str) -> String {
    // Strip the [Files & Changes] header from both sections
    let prev_body = section_body(prev);
    let fresh_body = section_body(fresh);
    #[derive(Hash, Eq, PartialEq, Clone, Copy)]
    enum Category {
        Modified,
        Created,
        Read,
    }

    let mut merged: HashMap<Category, HashSet<String>> = HashMap::new();
    merged.insert(Category::Modified, HashSet::new());
    merged.insert(Category::Created, HashSet::new());
    merged.insert(Category::Read, HashSet::new());

    let cat_prefixes = [
        (Category::Modified, "- Modified: "),
        (Category::Created, "- Created: "),
        (Category::Read, "- Read: "),
    ];

    for text in [prev_body, fresh_body] {
        for line in text.lines() {
            for (cat, prefix) in &cat_prefixes {
                if let Some(rest) = line.strip_prefix(prefix) {
                    // Strip "(+N more)" suffix
                    let rest = rest.split(" (+").next().unwrap_or(rest);
                    for path in rest.split(',') {
                        let trimmed = path.trim();
                        if !trimmed.is_empty() {
                            merged.get_mut(cat).unwrap().insert(trimmed.to_string());
                        }
                    }
                }
            }
        }
    }

    // Dedup: if a path is in Modified, drop it from Created
    let modified: Vec<String> = merged[&Category::Modified].iter().cloned().collect();
    for p in &modified {
        merged.get_mut(&Category::Created).unwrap().remove(p);
    }

    let cap = |set: &HashSet<String>, limit: usize| -> String {
        let mut arr: Vec<&String> = set.iter().collect();
        arr.sort();
        if arr.len() <= limit {
            arr.iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        } else {
            format!(
                "{} (+{} more)",
                arr[..limit]
                    .iter()
                    .map(|s| s.as_str())
                    .collect::<Vec<_>>()
                    .join(", "),
                arr.len() - limit
            )
        }
    };

    let mut lines: Vec<String> = Vec::new();
    let cat_order = [
        (Category::Modified, "Modified"),
        (Category::Created, "Created"),
        (Category::Read, "Read"),
    ];
    for (cat, label) in &cat_order {
        let set = &merged[cat];
        if !set.is_empty() {
            lines.push(format!("- {label}: {}", cap(set, 10)));
        }
    }

    if lines.is_empty() {
        return String::new();
    }

    format!("[Files & Changes]\n{}", lines.join("\n"))
}

/// Concatenate previous and fresh brief transcripts.
fn merge_brief_transcript(prev: &str, fresh: &str) -> String {
    match (prev.is_empty(), fresh.is_empty()) {
        (true, true) => String::new(),
        (true, false) => fresh.to_string(),
        (false, true) => prev.to_string(),
        (false, false) => format!("{prev}\n\n{fresh}"),
    }
}

/// Top-level merge: extract sections from both summaries, merge each, and
/// re-join with the separator.
fn merge_previous(prev: &str, fresh: &str) -> String {
    let mut headers: Vec<String> = Vec::new();
    for header in HEADER_NAMES {
        let merged_sec =
            merge_header_section(header, section_of(prev, header), section_of(fresh, header));
        if !merged_sec.is_empty() {
            headers.push(merged_sec);
        }
    }

    let prev_brief = brief_of(prev);
    let fresh_brief = brief_of(fresh);
    let merged_brief = merge_brief_transcript(prev_brief, fresh_brief);

    let mut parts: Vec<String> = Vec::new();
    if !headers.is_empty() {
        parts.push(headers.join("\n\n"));
    }
    if !merged_brief.is_empty() {
        parts.push(merged_brief);
    }

    parts.join(SECTION_SEPARATOR)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    // ==========
    // section_of
    // ==========

    #[rstest]
    fn section_of_extracts_between_headers() {
        let text = "[Session Goal]\n- fix bug\n- add tests\n\n[Files & Changes]\n- read: src/main.rs\n\n---\n\n[user]\nhello";
        assert_eq!(
            "[Session Goal]\n- fix bug\n- add tests",
            section_of(text, "Session Goal")
        );
        assert_eq!(
            "[Files & Changes]\n- read: src/main.rs",
            section_of(text, "Files & Changes")
        );
    }

    #[rstest]
    fn section_of_missing_header_returns_empty() {
        let text = "[Session Goal]\n- fix bug";
        assert_eq!(section_of(text, "Commits"), "");
    }

    #[rstest]
    fn section_of_last_section_ends_at_separator() {
        let text = "[User Preferences]\n- tabs\n\n---\n\n[user]\nhello";
        assert_eq!(
            "[User Preferences]\n- tabs",
            section_of(text, "User Preferences")
        );
    }

    #[rstest]
    fn section_of_no_separator_uses_end_of_text() {
        let text = "[Session Goal]\n- fix bug";
        assert_eq!(
            "[Session Goal]\n- fix bug",
            section_of(text, "Session Goal")
        );
    }

    // ============
    // section_body
    // ============

    #[rstest]
    fn section_body_strips_header() {
        assert_eq!(
            "- fix bug\n- add tests",
            section_body("[Session Goal]\n- fix bug\n- add tests")
        );
    }

    #[rstest]
    fn section_body_no_body_returns_empty() {
        assert_eq!(section_body("[Session Goal]"), "");
    }

    #[rstest]
    fn section_body_empty_input_returns_empty() {
        assert_eq!(section_body(""), "");
    }

    // ========
    // brief_of
    // ========

    #[rstest]
    fn brief_of_extracts_after_separator() {
        let text = "[Session Goal]\n- fix bug\n\n---\n\n[user]\nhello\n\n[assistant]\nworking";
        assert_eq!("[user]\nhello\n\n[assistant]\nworking", brief_of(text));
    }

    #[rstest]
    fn brief_of_no_separator_returns_empty() {
        let text = "[Session Goal]\n- fix bug";
        assert_eq!(brief_of(text), "");
    }

    // ==============================================
    // merge_header_section (Goals / Prefs / Commits)
    // ==============================================

    #[rstest]
    fn merge_section_dedup_lines() {
        let prev = "[Session Goal]\n- fix bug\n- add tests";
        let fresh = "[Session Goal]\n- fix bug\n- refactor";
        let result = merge_header_section("Session Goal", prev, fresh);
        assert!(result.contains("- fix bug"));
        assert!(result.contains("- add tests"));
        assert!(result.contains("- refactor"));
        // "fix bug" appears only once (deduped)
        assert_eq!(result.matches("- fix bug").count(), 1);
    }

    #[rstest]
    fn merge_section_prev_empty() {
        let fresh = "[User Preferences]\n- tabs";
        let result = merge_header_section("User Preferences", "", fresh);
        assert_eq!(result, fresh);
    }

    #[rstest]
    fn merge_section_fresh_empty() {
        let prev = "[User Preferences]\n- tabs";
        let result = merge_header_section("User Preferences", prev, "");
        assert_eq!(result, prev);
    }

    #[rstest]
    fn merge_section_both_empty() {
        let result = merge_header_section("Commits", "", "");
        assert_eq!(result, "");
    }

    #[rstest]
    fn merge_section_session_goal_cap_8() {
        let prev: String = format!(
            "[Session Goal]\n{}",
            (0..5)
                .map(|i| format!("- goal{i}"))
                .collect::<Vec<_>>()
                .join("\n")
        );
        let fresh: String = format!(
            "[Session Goal]\n{}",
            (5..12)
                .map(|i| format!("- goal{i}"))
                .collect::<Vec<_>>()
                .join("\n")
        );
        let result = merge_header_section("Session Goal", &prev, &fresh);
        // 12 unique items, capped to last 8
        let lines: Vec<&str> = result.lines().collect();
        assert_eq!(lines.len(), 9); // [Session Goal] header + 8 items
        assert!(!result.contains("goal0"));
        assert!(result.contains("goal11"));
    }

    #[rstest]
    fn merge_section_user_preferences_cap_15() {
        let items: Vec<String> = (0..20).map(|i| format!("- pref{i}")).collect();
        let prev = format!("[User Preferences]\n{}", items[..10].join("\n"));
        let fresh = format!("[User Preferences]\n{}", items[10..].join("\n"));
        let result = merge_header_section("User Preferences", &prev, &fresh);
        let lines: Vec<&str> = result.lines().collect();
        assert_eq!(lines.len(), 16); // header + 15 capped
        assert!(result.contains("pref19"));
        assert!(!result.contains("pref0"));
    }

    // ================
    // merge_file_lines
    // ================

    #[rstest]
    fn merge_files_combines_categories() {
        let prev = "[Files & Changes]\n- Modified: a.ts, b.ts\n- Read: c.ts";
        let fresh = "[Files & Changes]\n- Modified: b.ts, d.ts\n- Created: e.ts";
        let result = merge_file_lines(prev, fresh);
        assert!(result.contains("Modified:"));
        assert!(result.contains("a.ts"));
        assert!(result.contains("b.ts")); // appears in both, deduped
        assert!(result.contains("d.ts"));
        assert!(result.contains("Created:"));
        assert!(result.contains("e.ts"));
        assert!(result.contains("Read:"));
        assert!(result.contains("c.ts"));
    }

    #[rstest]
    fn merge_files_dedup_created_if_in_modified() {
        let prev = "[Files & Changes]\n- Modified: a.ts";
        let fresh = "[Files & Changes]\n- Created: a.ts, b.ts";
        let result = merge_file_lines(prev, fresh);
        assert!(result.contains("Modified: a.ts"));
        // a.ts should NOT be in Created
        if let Some(created_line) = result.lines().find(|l| l.contains("Created:")) {
            assert!(!created_line.contains("a.ts"));
            assert!(created_line.contains("b.ts"));
        } else {
            // Created might be empty entirely if only a.ts was there
        }
    }

    #[rstest]
    fn merge_files_handles_overflow() {
        let prev: String = format!(
            "[Files & Changes]\n{}",
            (0..12)
                .map(|i| format!("- Read: file{i}.ts"))
                .collect::<Vec<_>>()
                .join("\n")
        );
        let result = merge_file_lines(&prev, "");
        assert!(result.contains("(+2 more)"));
        // 10 capped + overflow message
        let read_line = result.lines().find(|l| l.starts_with("- Read:")).unwrap();
        // Should show 10 file paths
        assert_eq!(read_line.split(',').count(), 10);
    }

    #[rstest]
    fn merge_files_both_empty() {
        assert_eq!(merge_file_lines("", ""), "");
    }

    // ======================
    // merge_brief_transcript
    // ======================

    #[rstest]
    fn merge_brief_both_populated() {
        let result = merge_brief_transcript("[user]\nprev", "[user]\nfresh");
        assert_eq!(result, "[user]\nprev\n\n[user]\nfresh");
    }

    #[rstest]
    fn merge_brief_prev_empty() {
        assert_eq!(merge_brief_transcript("", "[user]\nfresh"), "[user]\nfresh");
    }

    #[rstest]
    fn merge_brief_fresh_empty() {
        assert_eq!(merge_brief_transcript("[user]\nprev", ""), "[user]\nprev");
    }

    #[rstest]
    fn merge_brief_both_empty() {
        assert_eq!(merge_brief_transcript("", ""), "");
    }

    // ==========================
    // merge_previous (top-level)
    // ==========================

    #[rstest]
    fn merge_previous_full_workflow() {
        let prev = "[Session Goal]\n- fix login bug\n\n---\n\n[user]\nold work";
        let fresh = "[Session Goal]\n- add auth tests\n\n[Files & Changes]\n- modified: auth.ts\n\n---\n\n[user]\nnew work\n\n[assistant]\ndone";
        let result = merge_previous(prev, fresh);

        // Both goals merged
        assert!(result.contains("fix login bug"));
        assert!(result.contains("add auth tests"));

        // Files section present
        assert!(result.contains("[Files & Changes]"));
        assert!(result.contains("auth.ts"));

        // Both brief transcripts concatenated
        assert!(result.contains("old work"));
        assert!(result.contains("new work"));

        // Separator between headers and brief
        assert!(result.contains("\n\n---\n\n"));
    }

    #[rstest]
    fn merge_previous_no_prev() {
        let fresh = "[Session Goal]\n- fix bug\n\n---\n\n[user]\nhello";
        let result = merge_previous("", fresh);
        assert_eq!(result, fresh);
    }

    #[rstest]
    fn merge_previous_no_fresh() {
        let prev = "[Session Goal]\n- old goal\n\n---\n\n[user]\nold";
        let result = merge_previous(prev, "");
        assert_eq!(result, prev);
    }

    #[rstest]
    fn merge_previous_both_empty() {
        assert_eq!(merge_previous("", ""), "");
    }

    // =========================
    // merge (public API)
    // =========================

    /// RECALL_NOTE is stripped by the TS shim before sending previousSummary.
    /// If it reaches Rust (legacy), merge passes it through as-is.
    #[rstest]
    fn merge_passes_through_recall_note() {
        let prev = "[Session Goal]\n- old goal\n\n---\n\n[user]\nold\n\n---\n\nUse `mm_recall` to search for prior work, decisions, and context from before this summary. Do not redo work already completed.";
        let fresh = "[Session Goal]\n- new goal\n\n---\n\n[user]\nnew";
        let result = merge(prev, fresh);
        // Passthrough: RECALL_NOTE is preserved (TS handles stripping)
        assert!(result.contains("mm_recall"));
        assert!(result.contains("old goal"));
        assert!(result.contains("new goal"));
    }

    #[rstest]
    fn merge_no_previous_summary() {
        let fresh = "[Session Goal]\n- fix bug\n\n---\n\n[user]\nhello";
        let result = merge("", fresh);
        assert_eq!(result, fresh);
    }
}
