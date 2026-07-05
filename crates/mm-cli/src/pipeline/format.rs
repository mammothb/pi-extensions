use crate::pipeline::brief::{self, BriefSection};
use crate::pipeline::sections::{commits, files, goals, preferences};
use crate::types::NormalizedBlock;
use serde::Serialize;

/// Assembled section data from all extractors plus the brief transcript.
#[derive(Debug, Default, Serialize)]
pub struct SectionData {
    pub session_goal: Vec<String>,
    pub files_and_changes: Vec<String>,
    pub commits: Vec<String>,
    pub user_preferences: Vec<String>,
    pub brief_transcript: String,
}

/// Render a single section with [Header] and bulleted lines.
fn render_section(header: &str, lines: &[String]) -> String {
    if lines.is_empty() {
        return String::new();
    }
    let mut out = vec![format!("[{header}]")];
    for line in lines {
        out.push(format!("- {line}"));
    }
    out.join("\n")
}

/// Separator between header sections and brief transcript.
const SECTION_SEPARATOR: &str = "\n\n---\n\n";

/// Format SectionData into human-readable text.
pub fn format_sections(data: &SectionData) -> String {
    let mut header_parts: Vec<String> = Vec::new();

    if !data.session_goal.is_empty() {
        header_parts.push(render_section("Session Goal", &data.session_goal));
    }

    if !data.files_and_changes.is_empty() {
        header_parts.push(render_section("Files & Changes", &data.files_and_changes));
    }

    if !data.commits.is_empty() {
        let lines: Vec<String> = data.commits.iter().map(|c| format!("- {c}")).collect();
        header_parts.push(format!("[Commits]\n{}", lines.join("\n")));
    }

    if !data.user_preferences.is_empty() {
        header_parts.push(render_section("User Preferences", &data.user_preferences));
    }

    let mut parts: Vec<String> = Vec::new();
    if !header_parts.is_empty() {
        parts.push(header_parts.join("\n\n"));
    }
    if !data.brief_transcript.is_empty() {
        parts.push(data.brief_transcript.clone());
    }

    parts.join(SECTION_SEPARATOR)
}

/// Format SectionData as a JSON value.
pub fn format_sections_json(data: &SectionData) -> serde_json::Value {
    serde_json::to_value(data).unwrap_or(serde_json::Value::Null)
}

/// Run all section extractors and brief compilation, returning SectionData.
pub fn build_section_data(blocks: &[NormalizedBlock]) -> SectionData {
    let goals = goals::extract_goals(blocks);
    let file_activity = files::extract_files(blocks);

    let mut files_and_changes: Vec<String> = Vec::new();
    files_and_changes.extend(file_activity.read.iter().map(|p| format!("read: {p}")));
    files_and_changes.extend(
        file_activity
            .modified
            .iter()
            .map(|p| format!("modified: {p}")),
    );
    files_and_changes.extend(
        file_activity
            .created
            .iter()
            .map(|p| format!("created: {p}")),
    );
    files_and_changes.sort();
    files_and_changes.dedup();

    let raw_commits = commits::extract_commits(blocks);
    let commit_lines = commits::format_commits(&raw_commits, 8);

    let raw_prefs = preferences::extract_preferences(blocks);
    let prefs = preferences::dedup_preferences_against_goals(&raw_prefs, &goals);

    let brief = brief::compile_brief(blocks);

    SectionData {
        session_goal: goals,
        files_and_changes,
        commits: commit_lines,
        user_preferences: prefs,
        brief_transcript: brief,
    }
}

/// Full pipeline: build SectionData → format as text.
pub fn compile_full(blocks: &[NormalizedBlock]) -> String {
    let data = build_section_data(blocks);
    format_sections(&data)
}

/// Stringify BriefSection sections into text format.
pub(crate) fn stringify_brief(sections: &[BriefSection]) -> String {
    let mut out: Vec<String> = Vec::new();

    for (i, sec) in sections.iter().enumerate() {
        if i > 0 {
            let prev = &sections[i - 1];
            let prev_is_tools =
                prev.header == "[assistant]" && prev.lines.iter().all(|l| l.starts_with("* "));
            let cur_is_tools =
                sec.header == "[assistant]" && sec.lines.iter().all(|l| l.starts_with("* "));

            // Suppress blank lines between consecutive tool-only sections
            if !(prev_is_tools && cur_is_tools) {
                out.push(String::new());
            }
        }
        out.push(sec.header.to_string());
        for line in &sec.lines {
            out.push(line.clone());
        }
    }

    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::{fixture, rstest};

    // =======
    // Helpers
    // =======

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

    fn tool_call(name: &str, file_path: &str, idx: usize) -> NormalizedBlock {
        NormalizedBlock::ToolCall {
            name: name.into(),
            args: serde_json::json!({"file_path": file_path}),
            source_index: idx,
        }
    }

    fn bash_block(command: &str, output: &str, idx: usize) -> NormalizedBlock {
        NormalizedBlock::Bash {
            command: command.into(),
            output: output.into(),
            exit_code: Some(0),
            source_index: idx,
        }
    }

    // ========
    // Fixtures
    // ========

    #[fixture]
    fn empty_data() -> SectionData {
        SectionData::default()
    }

    // ===============
    // stringify_brief
    // ===============

    #[rstest]
    #[case::empty(&[], "")]
    #[case::single_section(
        &[BriefSection { header: "[user]", lines: vec!["fix bug".into(), "add tests".into()] }],
        "[user]\nfix bug\nadd tests"
    )]
    #[case::blank_between_different_roles(
        &[
            BriefSection { header: "[user]", lines: vec!["hello".into()] },
            BriefSection { header: "[assistant]", lines: vec!["world".into()] },
        ],
        "[user]\nhello\n\n[assistant]\nworld"
    )]
    #[case::no_blank_between_tool_only_sections(
        &[
            BriefSection { header: "[assistant]", lines: vec!["* Read \"a.ts\" (#0)".into()] },
            BriefSection { header: "[assistant]", lines: vec!["* Read \"b.ts\" (#2)".into()] },
        ],
        "[assistant]\n* Read \"a.ts\" (#0)\n[assistant]\n* Read \"b.ts\" (#2)"
    )]
    #[case::blank_between_mixed_sections(
        &[
            BriefSection { header: "[assistant]", lines: vec!["* Read \"a.ts\" (#0)".into()] },
            BriefSection { header: "[assistant]", lines: vec!["Found the issue".into()] },
        ],
        "[assistant]\n* Read \"a.ts\" (#0)\n\n[assistant]\nFound the issue"
    )]
    fn stringify_brief_cases(#[case] sections: &[BriefSection], #[case] expected: &str) {
        assert_eq!(stringify_brief(sections), expected);
    }

    // ===============
    // format_sections
    // ===============

    #[rstest]
    fn format_sections_empty_data(empty_data: SectionData) {
        assert_eq!(format_sections(&empty_data), "");
    }

    #[rstest]
    fn format_sections_only_goal() {
        let data = SectionData {
            session_goal: vec!["fix bug".into()],
            ..SectionData::default()
        };
        assert_eq!(format_sections(&data), "[Session Goal]\n- fix bug");
    }

    #[rstest]
    fn format_sections_only_brief() {
        let data = SectionData {
            brief_transcript: "[user]\nhello".into(),
            ..SectionData::default()
        };
        assert_eq!(format_sections(&data), "[user]\nhello");
    }

    #[rstest]
    fn format_sections_commits_bullet_format() {
        let data = SectionData {
            commits: vec!["abc123: fix login".into(), "def456: add tests".into()],
            ..SectionData::default()
        };
        assert_eq!(
            format_sections(&data),
            "[Commits]\n- abc123: fix login\n- def456: add tests"
        );
    }

    #[rstest]
    fn format_sections_multiple_separated_by_blank_lines() {
        let data = SectionData {
            session_goal: vec!["fix bug".into()],
            files_and_changes: vec!["read: src/main.rs".into()],
            ..SectionData::default()
        };
        let result = format_sections(&data);
        assert!(result.contains("\n\n"));
        assert!(result.contains("[Session Goal]"));
        assert!(result.contains("[Files & Changes]"));
    }

    #[rstest]
    fn format_sections_empty_commit_omitted() {
        let data = SectionData {
            session_goal: vec!["fix bug".into()],
            ..SectionData::default()
        };
        let result = format_sections(&data);
        assert!(!result.contains("[Commits]"));
        assert!(result.contains("[Session Goal]"));
    }

    #[rstest]
    fn format_sections_all_sections_populated() {
        let data = SectionData {
            session_goal: vec!["implement auth".into()],
            files_and_changes: vec!["modified: auth.ts".into()],
            commits: vec!["abc123: add auth module".into()],
            user_preferences: vec!["prefer tabs".into()],
            brief_transcript: "[user]\nadd auth\n\n[assistant]\nworking...".into(),
        };
        let result = format_sections(&data);
        assert!(result.contains("[Session Goal]"));
        assert!(result.contains("[Files & Changes]"));
        assert!(result.contains("[Commits]"));
        assert!(result.contains("[User Preferences]"));
        assert!(result.contains("[user]\nadd auth"));
        assert!(result.contains("[assistant]\nworking..."));
    }

    // ==================
    // build_section_data
    // ==================

    #[rstest]
    fn build_data_user_goal_extracted() {
        let blocks = vec![user_block("fix the login bug", 0)];
        let data = build_section_data(&blocks);
        assert!(!data.session_goal.is_empty());
        assert!(data.brief_transcript.contains("fix the login bug"));
    }

    #[rstest]
    fn build_data_file_activity_detected() {
        let blocks = vec![tool_call("Read", "src/main.rs", 0)];
        let data = build_section_data(&blocks);
        assert!(!data.files_and_changes.is_empty());
        assert!(
            data.files_and_changes
                .iter()
                .any(|f| f.contains("src/main.rs"))
        );
    }

    #[rstest]
    fn build_data_commit_detected() {
        let blocks = vec![bash_block(
            "git commit -m 'fix bug'",
            "[main abc1234] fix bug",
            0,
        )];
        let data = build_section_data(&blocks);
        assert!(!data.commits.is_empty());
    }

    #[rstest]
    fn build_data_preference_detected() {
        // First block establishes goals; second has a preference statement that
        // won't be re-classified as a goal (no task verb, no scope change).
        let blocks = vec![
            user_block("fix the login bug", 0),
            user_block("always use tabs for indentation", 1),
        ];
        let data = build_section_data(&blocks);
        assert!(!data.user_preferences.is_empty());
    }

    #[rstest]
    fn build_data_empty_blocks() {
        let data = build_section_data(&[]);
        assert!(data.session_goal.is_empty());
        assert!(data.files_and_changes.is_empty());
        assert!(data.commits.is_empty());
        assert!(data.user_preferences.is_empty());
        assert_eq!(data.brief_transcript, "");
    }

    // ============
    // compile_full
    // ============

    #[rstest]
    fn compile_full_integration() {
        let blocks = vec![
            user_block("implement auth", 0),
            assistant_block("Let me check the codebase.", 1),
            tool_call("Read", "src/auth.ts", 2),
            assistant_block("I'll add the auth module.", 3),
            tool_call("Write", "src/auth.ts", 4),
            bash_block(
                "git commit -m 'add auth module'",
                "[main def5678] add auth module",
                5,
            ),
            user_block("prefer functional style", 6),
        ];
        let result = compile_full(&blocks);
        assert!(result.contains("[Session Goal]"));
        assert!(result.contains("[Files & Changes]"));
        assert!(result.contains("[Commits]"));
        assert!(result.contains("[User Preferences]"));
        assert!(result.contains("[user]"));
        assert!(result.contains("[assistant]"));
    }

    #[rstest]
    fn compile_full_empty() {
        assert_eq!(compile_full(&[]), "");
    }

    // =====================
    // format_sections_json
    // =====================

    #[rstest]
    fn json_empty_data() {
        let data = SectionData::default();
        let json = format_sections_json(&data);
        assert!(json.is_object());
        assert_eq!(json["session_goal"], serde_json::json!([]));
        assert_eq!(json["files_and_changes"], serde_json::json!([]));
        assert_eq!(json["commits"], serde_json::json!([]));
        assert_eq!(json["user_preferences"], serde_json::json!([]));
        assert_eq!(json["brief_transcript"], serde_json::json!(""));
    }

    #[rstest]
    fn json_populated_data() {
        let data = SectionData {
            session_goal: vec!["fix bug".into()],
            files_and_changes: vec!["read: src/main.rs".into()],
            commits: vec!["abc123: fix login".into()],
            user_preferences: vec!["prefer tabs".into()],
            brief_transcript: "[user]\nhello".into(),
        };
        let json = format_sections_json(&data);
        assert_eq!(json["session_goal"], serde_json::json!(["fix bug"]));
        assert_eq!(
            json["files_and_changes"],
            serde_json::json!(["read: src/main.rs"])
        );
        assert_eq!(json["commits"], serde_json::json!(["abc123: fix login"]));
        assert_eq!(json["user_preferences"], serde_json::json!(["prefer tabs"]));
        assert_eq!(json["brief_transcript"], serde_json::json!("[user]\nhello"));
    }
}
