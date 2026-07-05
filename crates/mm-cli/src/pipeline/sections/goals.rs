use std::{collections::HashSet, sync::LazyLock};

use regex::Regex;

use crate::types::NormalizedBlock;

// ==============
// Regex patterns
// ==============

static TEMPLATE_SIGNAL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)^\s*(For each\b|Do NOT implement\b|Analyze and propose\b|If Task/context\b|Output:\s*$)",
    )
    .unwrap()
});

static NON_GOAL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)^\s*[\[│├└─╭╰]|```|^\s*(=[A-Z]+\(|function |const |let |var |import |export |class )|^(https?:|file:|/[A-Za-z])|\\n|^\s*For each\b|\bin full\b[^\n]*\b(comments|issue|issues|PRs?|linked)\b",
    )
    .unwrap()
});

static NOISE_SHORT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(ok|yes|no|sure|yeah|yep|go|hi|hey|thx|thanks|ok\b.*|y|n|k)\s*[.!?]*$")
        .unwrap()
});

static SCOPE_CHANGE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(instead|actually|change of plan|forget that|new task|switch to|now I want|pivot|let'?s do|stop .* and)\b",
    )
    .unwrap()
});

static TASK_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(fix|implement|add|create|build|refactor|debug|investigate|update|remove|delete|migrate|deploy|test|write|set up)\b",
    )
    .unwrap()
});

static SKILL_TAG_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"^-?\s*<skill\s+name="([^"]+)"#).unwrap());

static SKILL_CLOSE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^-?\s*</skill>").unwrap());

static STRIP_BULLET_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*(?:[-*+]|\d+\.)\s+").unwrap());

// =========
// Constants
// =========

const MAX_GOAL_CHARS: usize = 200;
const LEADING_CHARS: usize = 200;
const MAX_INITIAL_GOALS: usize = 6;
const MAX_SCOPE_CHANGE_LINES: usize = 3;
const MAX_TASK_LINES: usize = 2;
const MAX_TOTAL_GOALS: usize = 8;
const MIN_LINE_LENGTH: usize = 5;
const MIN_TASK_LINE: usize = 15;

// ==========
// Public API
// ==========

/// Extract session goals from a sequence of normalized blocks.
///
/// Only `User` blocks are examined. The first user block contributes up to 6
/// initial goals. Subsequent blocks are scanned for scope-change or task-verb
/// signals; when detected, up to 3 (scope-change) or 2 (task) additional goal
/// lines are appended with a `[Scope change]` marker. Output is capped at 8
/// entries.
pub fn extract_goals(blocks: &[NormalizedBlock]) -> Vec<String> {
    let mut goals: Vec<String> = Vec::new();
    let mut latest_scope_change: Option<Vec<String>> = None;

    for b in blocks {
        let text = match b {
            NormalizedBlock::User { text, .. } => text.as_str(),
            _ => continue,
        };

        let raw_lines = non_empty_lines(text);
        let truncated = truncate_at_template(&raw_lines);
        let substantive: Vec<&str> = truncated
            .iter()
            .filter(|l| is_substantive_goal(l))
            .copied()
            .collect();
        let collapsed = collapse_skill_lines(&substantive);
        let lines: Vec<String> = collapsed
            .iter()
            .map(|l| STRIP_BULLET_RE.replace(l, "").trim().to_string())
            .filter(|l| l.len() > MIN_LINE_LENGTH)
            .collect();

        if lines.is_empty() {
            continue;
        }

        if goals.is_empty() {
            goals.extend(lines.into_iter().take(MAX_INITIAL_GOALS));
            continue;
        }

        let end = char_boundary_at_or_before(text, LEADING_CHARS);
        let leading = &text[..end];
        if SCOPE_CHANGE_RE.is_match(leading) {
            latest_scope_change = Some(
                lines
                    .into_iter()
                    .take(MAX_SCOPE_CHANGE_LINES)
                    .map(|l| clip(&l, MAX_GOAL_CHARS))
                    .collect(),
            );
        } else if TASK_RE.is_match(leading)
            && lines.first().is_some_and(|l| l.len() > MIN_TASK_LINE)
        {
            latest_scope_change = Some(
                lines
                    .into_iter()
                    .take(MAX_TASK_LINES)
                    .map(|l| clip(&l, MAX_GOAL_CHARS))
                    .collect(),
            );
        }
    }

    if let Some(ref changes) = latest_scope_change
        && !changes.is_empty()
    {
        goals.push("[Scope change]".to_string());
        goals.extend(changes.iter().cloned());
    }

    goals.truncate(MAX_TOTAL_GOALS);
    goals
}

// ===============
// Private helpers
// ===============

/// Find the greatest char boundary ≤ `target` in `text`.
/// Needed because `floor_char_boundary` was stabilized in 1.91 and our MSRV
/// is 1.88.
fn char_boundary_at_or_before(text: &str, target: usize) -> usize {
    let mut end = text.len().min(target);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    end
}

/// Clip text at a word boundary near `max` chars.
fn clip(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let max = char_boundary_at_or_before(text, max);
    let haystack = &text[..max];
    let end = match haystack.rfind(' ') {
        Some(pos) if pos > max * 6 / 10 => pos,
        _ => max,
    };
    text[..end].to_string()
}

/// Collapse `<skill name="X">...</skill>` blocks across lines.
/// Deduplicates by skill name. Returns owned strings.
fn collapse_skill_lines(lines: &[&str]) -> Vec<String> {
    let mut result: Vec<String> = Vec::new();
    let mut seen = HashSet::new();
    let mut inside = false;

    for line in lines {
        if let Some(caps) = SKILL_TAG_RE.captures(line) {
            inside = true;
            let name = caps.get(1).unwrap().as_str();
            if seen.insert(name.to_string()) {
                result.push(format!("[skill: {}]", name));
            }
            continue;
        }
        if inside {
            if SKILL_CLOSE_RE.is_match(line) {
                inside = false;
            }
            continue;
        }
        result.push(line.to_string());
    }
    result
}

/// True if a trimmed line passes the substance checks.
fn is_substantive_goal(line: &str) -> bool {
    let t = line.trim();
    t.len() > MIN_LINE_LENGTH
        && t.len() <= MAX_GOAL_CHARS
        && !NOISE_SHORT_RE.is_match(t)
        && !NON_GOAL_RE.is_match(t)
}

/// Split text into non-empty trimmed lines.
fn non_empty_lines(text: &str) -> Vec<&str> {
    text.split('\n')
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect()
}

/// Find the first template-signal line and drop it and everything after.
fn truncate_at_template<'a>(lines: &'a [&'a str]) -> &'a [&'a str] {
    match lines.iter().position(|l| TEMPLATE_SIGNAL_RE.is_match(l)) {
        Some(idx) => &lines[..idx],
        None => lines,
    }
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

    // ================
    // Basic extraction
    // ================

    #[rstest]
    fn single_user_block_simple_goal() {
        let blocks = [user_block("fix the login bug", 0)];
        assert_eq!(extract_goals(&blocks), vec!["fix the login bug"]);
    }

    #[rstest]
    fn single_user_block_caps_at_6() {
        let blocks = [user_block(
            "fix login\nadd dark mode\nupdate docs\nremove dead code\ndeploy to prod\nmigrate db\nseventh goal",
            0,
        )];
        let goals = extract_goals(&blocks);
        assert_eq!(goals.len(), 6);
        assert!(!goals.contains(&"seventh goal".to_string()));
    }

    // ===============
    // Noise rejection
    // ===============

    #[rstest]
    #[case("ok")]
    #[case("yes")]
    #[case("no")]
    #[case("sure")]
    #[case("yeah")]
    #[case("hi")]
    #[case("hey")]
    #[case("thx")]
    #[case("thanks")]
    #[case("y")]
    #[case("n")]
    #[case("k")]
    fn noise_word_rejected(#[case] word: &str) {
        let blocks = [user_block(word, 0)];
        assert!(
            extract_goals(&blocks).is_empty(),
            "expected '{word}' to be rejected as noise"
        );
    }

    #[rstest]
    #[case("ok.")]
    #[case("yes!")]
    fn noise_word_with_punctuation_rejected(#[case] word: &str) {
        let blocks = [user_block(word, 0)];
        assert!(extract_goals(&blocks).is_empty());
    }

    // ===================
    // Template truncation
    // ===================

    #[rstest]
    #[case("fix auth\nFor each issue:\n  Read the issue in full", "fix auth")]
    #[case("add feature\nDo NOT implement tests yet\nsome detail", "add feature")]
    #[case("refactor module\nOutput:\n  - item 1\n  - item 2", "refactor module")]
    fn template_truncation(#[case] input: &str, #[case] expected: &str) {
        let blocks = [user_block(input, 0)];
        assert_eq!(extract_goals(&blocks), vec![expected]);
    }

    // ============
    // Scope change
    // ============

    #[rstest]
    fn scope_change_marker() {
        let blocks = [
            user_block("fix the login bug", 0),
            user_block("actually, implement dark mode instead", 1),
        ];
        let goals = extract_goals(&blocks);
        assert!(goals.contains(&"[Scope change]".to_string()));
        assert!(goals.iter().any(|g| g.contains("dark mode")));
    }

    #[rstest]
    fn scope_change_pivot() {
        let blocks = [
            user_block("refactor auth", 0),
            user_block("pivot to a new approach with JWT", 1),
        ];
        let goals = extract_goals(&blocks);
        assert!(goals.contains(&"[Scope change]".to_string()));
    }

    #[rstest]
    fn new_task_verb_without_scope_change() {
        let blocks = [
            user_block("fix the login bug", 0),
            user_block("implement password reset too", 1),
        ];
        let goals = extract_goals(&blocks);
        // "implement" is a task verb, line > 15 chars → triggers new task lines
        assert!(goals.contains(&"[Scope change]".to_string()));
    }

    #[rstest]
    fn short_task_line_no_scope_change() {
        let blocks = [
            user_block("fix the login bug", 0),
            user_block("add tests", 1), // < 15 chars → no scope change
        ];
        let goals = extract_goals(&blocks);
        assert_eq!(goals, vec!["fix the login bug"]);
    }

    // ================
    // Bullet stripping
    // ================

    #[rstest]
    #[case("- fix the login bug", "fix the login bug")]
    #[case("* refactor auth module", "refactor auth module")]
    #[case("1. implement dark mode", "implement dark mode")]
    fn bullet_stripped(#[case] input: &str, #[case] expected: &str) {
        let blocks = [user_block(input, 0)];
        assert_eq!(extract_goals(&blocks), vec![expected]);
    }

    // ==============
    // Skill collapse
    // ==============

    #[rstest]
    fn skill_tag_collapsed() {
        let blocks = [user_block(r#"<skill name="foo">some content</skill>"#, 0)];
        assert_eq!(extract_goals(&blocks), vec!["[skill: foo]"]);
    }

    #[rstest]
    fn skill_tag_dedup() {
        let blocks = [user_block(
            r#"<skill name="foo">first</skill>
<skill name="foo">second</skill>"#,
            0,
        )];
        let goals = extract_goals(&blocks);
        // Only one [skill: foo] entry
        assert_eq!(
            goals
                .iter()
                .filter(|g| g.as_str() == "[skill: foo]")
                .count(),
            1
        );
    }

    #[rstest]
    fn skill_tag_multiline() {
        let blocks = [user_block(
            r#"<skill name="foo">
content line 1
content line 2
</skill>
regular goal here"#,
            0,
        )];
        let goals = extract_goals(&blocks);
        assert!(goals.contains(&"[skill: foo]".to_string()));
        assert!(goals.contains(&"regular goal here".to_string()));
    }

    // =========================
    // NON_GOAL_RE line rejection
    // =========================

    #[rstest]
    #[case("```rust\nfunction x() {}\n```")]
    #[case("function foo() { return 42; }")]
    #[case("const x = 42;")]
    #[case("/src/main.rs")]
    #[case("http://example.com")]
    #[case("file:///home/user/config.toml")]
    fn non_goal_line_rejected(#[case] input: &str) {
        let blocks = [user_block(input, 0)];
        assert!(extract_goals(&blocks).is_empty());
    }

    // ====================
    // Short line rejection
    // ====================

    #[rstest]
    fn short_lines_rejected() {
        let blocks = [user_block("ab\ncd ef", 0)];
        assert!(extract_goals(&blocks).is_empty());
    }

    // =======================
    // Non-user blocks ignored
    // =======================

    #[rstest]
    fn assistant_blocks_ignored() {
        let blocks = [
            assistant_block("I'll fix the login bug", 0),
            user_block("fix the login bug", 1),
        ];
        assert_eq!(extract_goals(&blocks), vec!["fix the login bug"]);
    }

    // ==============
    // Cap at 8 total
    // ==============

    #[rstest]
    fn caps_at_8_total_with_scope_change() {
        let blocks = [
            user_block("goal 1\ngoal 2\ngoal 3\ngoal 4\ngoal 5\ngoal 6", 0),
            user_block("actually change to task alpha\ntask beta\ntask gamma", 1),
        ];
        let goals = extract_goals(&blocks);
        assert!(
            goals.len() <= 8,
            "expected ≤ 8 goals, got {}: {goals:?}",
            goals.len()
        );
    }

    // =================================
    // "In full ... issue/PRs" rejection
    // =================================

    #[rstest]
    fn in_full_comments_rejected() {
        let blocks = [user_block(
            "Read the issue in full with comments and linked PRs",
            0,
        )];
        assert!(extract_goals(&blocks).is_empty());
    }

    // ==================================
    // Box-drawing / table chars rejected
    // ==================================

    #[rstest]
    fn box_drawing_rejected() {
        let blocks = [user_block("├── src/main.rs", 0)];
        assert!(extract_goals(&blocks).is_empty());
    }

    // =================================================
    // Multi-byte UTF-8 crossing the LEADING_CHARS slice
    // =================================================

    /// Regression: `⎯` (U+23AF, 3 bytes) repeated so that byte 200 falls
    /// inside the 67th character. Before the `floor_char_boundary` fix,
    /// `&text[..200]` would panic on this input.
    #[rstest]
    fn leading_slice_at_multibyte_boundary() {
        // 67 × "⎯" = 201 bytes. Byte 200 is inside the 67th character.
        let rule = "⎯".repeat(67);
        // Must contain a scope-change signal so the leading slice is exercised.
        let text = format!("{rule}\nactually let's fix the login bug instead");
        let blocks = [user_block("initial task", 0), user_block(&text, 1)];
        // Should not panic.
        let goals = extract_goals(&blocks);
        assert!(!goals.is_empty(), "should extract scope-change goal");
    }
}
