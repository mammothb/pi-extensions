use std::{collections::HashSet, sync::LazyLock};

use regex::Regex;

use crate::types::NormalizedBlock;

// ===================
// Preference patterns
// ===================

static PREF_PATTERNS: LazyLock<[Regex; 6]> = LazyLock::new(|| {
    [
        // "I prefer tabs", "preferring dark mode"
        Regex::new(r"(?i)\bprefer(?:s|red|ring)?\s+\w").unwrap(),
        // "I don't want linting"
        Regex::new(r"(?i)\bdon'?t want\b").unwrap(),
        // "always use gitmoji for commits"
        Regex::new(
            r"(?i)\balways (?:use|do|run|prefer|keep|make|format|write|add|set|put|prefix|start|include|append)\b",
        )
        .unwrap(),
        // "never push to main"
        Regex::new(
            r"(?i)\bnever (?:use|do|run|push|commit|write|ignore|add|set|put|remove|delete|include|deploy)\b",
        )
        .unwrap(),
        // "please use TypeScript for new files"
        Regex::new(
            r"(?i)\bplease (?:use|avoid|keep|make|don'?t|do not|format|write)\b",
        )
        .unwrap(),
        // "style: functional", "naming=snake_case"
        Regex::new(r"(?i)\b(?:style|format|language|naming)\s*[:=]\s*\S").unwrap(),
    ]
});

// =========
// Constants
// =========

const MAX_LINE_CHARS: usize = 200;
const MIN_LINE_CHARS: usize = 5;
const MAX_PER_BLOCK: usize = 1;
const MAX_TOTAL_PREFS: usize = 10;

// ==========
// Public API
// ==========

/// Extract user preferences from user messages.
///
/// Only `User` blocks are examined. Each line is tested against preference
/// patterns (`prefer`, `always`, `never`, `please`, `style:`, etc.).
/// Questions are skipped. Results are deduplicated (case-insensitive),
/// capped at 1 per user block, and 10 total.
pub fn extract_preferences(blocks: &[NormalizedBlock]) -> Vec<String> {
    let mut prefs: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for b in blocks {
        let text = match b {
            NormalizedBlock::User { text, .. } => text.as_str(),
            _ => continue,
        };

        let mut per_block = 0;
        for line in non_empty_lines(text) {
            if line.len() < MIN_LINE_CHARS || line.len() > MAX_LINE_CHARS {
                continue;
            }
            // Reject questions
            if line.ends_with('?') || line.contains("?...") {
                continue;
            }
            // Must match at least one preference pattern
            if !PREF_PATTERNS.iter().any(|re| re.is_match(line)) {
                continue;
            }

            let clipped = clip(line, MAX_LINE_CHARS);
            let key = clipped.to_lowercase();
            if seen.contains(&key) {
                continue;
            }
            seen.insert(key);
            prefs.push(clipped);

            per_block += 1;
            if per_block >= MAX_PER_BLOCK {
                break;
            }
        }
    }

    prefs.truncate(MAX_TOTAL_PREFS);
    prefs
}

/// Remove preferences that duplicate goals (case-insensitive, trimmed).
pub fn dedup_preferences_against_goals(prefs: &[String], goals: &[String]) -> Vec<String> {
    let norm = |s: &str| s.trim().to_lowercase();
    let goal_set: HashSet<String> = goals.iter().map(|g| norm(g)).collect();
    prefs
        .iter()
        .filter(|p| !goal_set.contains(&norm(p)))
        .cloned()
        .collect()
}

// ===============
// Private helpers
// ===============

/// Split text into non-empty trimmed lines.
fn non_empty_lines(text: &str) -> Vec<&str> {
    text.split('\n')
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect()
}

/// Clip text at a word boundary near `max` chars.
fn clip(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let haystack = &text[..max];
    let end = match haystack.rfind(' ') {
        Some(pos) if pos > max * 6 / 10 => pos,
        _ => max,
    };
    let mut end = end;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    fn user_block(text: &str, idx: usize) -> NormalizedBlock {
        NormalizedBlock::User {
            text: text.into(),
            source_index: idx,
        }
    }

    fn assistant_block(text: &str, idx: usize) -> NormalizedBlock {
        NormalizedBlock::Assistant {
            text: text.into(),
            source_index: idx,
        }
    }

    // ===================
    // extract_preferences
    // ===================

    #[rstest]
    fn prefer_tabs() {
        let blocks = [user_block("I prefer tabs over spaces", 0)];
        let prefs = extract_preferences(&blocks);
        assert_eq!(prefs, vec!["I prefer tabs over spaces"]);
    }

    #[rstest]
    fn dont_want_linting() {
        let blocks = [user_block("don't want linting in this project", 0)];
        let prefs = extract_preferences(&blocks);
        assert_eq!(prefs, vec!["don't want linting in this project"]);
    }

    #[rstest]
    fn always_use_gitmoji() {
        let blocks = [user_block("always use gitmoji for commits", 0)];
        let prefs = extract_preferences(&blocks);
        assert_eq!(prefs, vec!["always use gitmoji for commits"]);
    }

    #[rstest]
    fn never_push_to_main() {
        let blocks = [user_block("never push to main branch", 0)];
        let prefs = extract_preferences(&blocks);
        assert_eq!(prefs, vec!["never push to main branch"]);
    }

    #[rstest]
    fn style_colon_functional() {
        let blocks = [user_block("style: functional", 0)];
        let prefs = extract_preferences(&blocks);
        assert_eq!(prefs, vec!["style: functional"]);
    }

    #[rstest]
    fn please_use_typescript() {
        let blocks = [user_block("please use TypeScript for new files", 0)];
        let prefs = extract_preferences(&blocks);
        assert_eq!(prefs, vec!["please use TypeScript for new files"]);
    }

    #[rstest]
    fn question_rejected() {
        let blocks = [user_block("what time is it?", 0)];
        let prefs = extract_preferences(&blocks);
        assert!(prefs.is_empty());
    }

    #[rstest]
    fn short_line_rejected() {
        let blocks = [user_block("ok", 0)];
        let prefs = extract_preferences(&blocks);
        assert!(prefs.is_empty());
    }

    #[rstest]
    fn per_block_cap_one() {
        let blocks = [user_block(
            "I prefer tabs\nstyle: functional\nplease use TypeScript",
            0,
        )];
        let prefs = extract_preferences(&blocks);
        assert_eq!(prefs.len(), 1);
    }

    #[rstest]
    fn global_cap_ten() {
        // 11 user blocks, each with one preference → only 10 kept
        let mut blocks: Vec<NormalizedBlock> = Vec::new();
        for i in 0..11 {
            blocks.push(user_block(&format!("always use tool_{i}"), i));
        }
        let prefs = extract_preferences(&blocks);
        assert_eq!(prefs.len(), 10);
    }

    #[rstest]
    fn extract_case_insensitive_dedup() {
        let blocks = [
            user_block("I prefer Rust", 0),
            user_block("i prefer rust", 1),
        ];
        let prefs = extract_preferences(&blocks);
        assert_eq!(prefs.len(), 1);
        assert_eq!(prefs[0], "I prefer Rust");
    }

    #[rstest]
    fn non_user_blocks_ignored() {
        let blocks = [
            assistant_block("I'll use tabs", 0),
            user_block("I prefer tabs", 1),
        ];
        let prefs = extract_preferences(&blocks);
        assert_eq!(prefs, vec!["I prefer tabs"]);
    }

    #[rstest]
    fn empty_blocks_returns_empty() {
        assert!(extract_preferences(&[]).is_empty());
    }

    #[rstest]
    fn prefer_red() {
        let blocks = [user_block("preferred approach is functional style", 0)];
        let prefs = extract_preferences(&blocks);
        assert_eq!(prefs, vec!["preferred approach is functional style"]);
    }

    #[rstest]
    fn preferring() {
        let blocks = [user_block("preferring dark mode for all UIs", 0)];
        let prefs = extract_preferences(&blocks);
        assert_eq!(prefs, vec!["preferring dark mode for all UIs"]);
    }

    // ===============================
    // dedup_preferences_against_goals
    // ===============================

    #[rstest]
    fn dedup_no_overlap() {
        let prefs = vec!["use tabs".to_string()];
        let goals = vec!["implement tabs".to_string()];
        let result = dedup_preferences_against_goals(&prefs, &goals);
        assert_eq!(result, vec!["use tabs"]);
    }

    #[rstest]
    fn dedup_exact_overlap() {
        let prefs = vec!["use tabs".to_string()];
        let goals = vec!["use tabs".to_string()];
        let result = dedup_preferences_against_goals(&prefs, &goals);
        assert!(result.is_empty());
    }

    #[rstest]
    fn dedup_case_insensitive() {
        let prefs = vec!["Use Tabs".to_string()];
        let goals = vec!["use tabs".to_string()];
        let result = dedup_preferences_against_goals(&prefs, &goals);
        assert!(result.is_empty());
    }

    #[rstest]
    fn dedup_whitespace_insensitive() {
        let prefs = vec!["  use tabs  ".to_string()];
        let goals = vec!["use tabs".to_string()];
        let result = dedup_preferences_against_goals(&prefs, &goals);
        assert!(result.is_empty());
    }
}
