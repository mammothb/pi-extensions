use std::collections::HashMap;

use anyhow::Result;
use log::{error, warn};
use regex::Regex;

use crate::claude;
use crate::commands::ExitStatus;
use crate::lex::lex;
use crate::paths::expand_paths;
use crate::pi;
use crate::types::{ContentBlock, Message};

// ==============
// BM25 constants
// ==============

const BM25_K: f64 = 1.2;
const BM25_B: f64 = 0.75;
const RESULTS_PER_PAGE: usize = 5;

// =========
// Stopwords
// =========

const STOPWORDS: &[&str] = &[
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
    "do", "does", "did", "will", "would", "could", "should", "may", "might", "can", "shall", "of",
    "in", "to", "for", "with", "on", "at", "from", "by", "as", "into", "through", "during",
    "before", "after", "above", "below", "between", "out", "off", "over", "under", "again",
    "further", "then", "once", "here", "there", "when", "where", "why", "how", "all", "both",
    "each", "few", "more", "most", "other", "some", "such", "no", "nor", "not", "only", "own",
    "same", "so", "than", "too", "very", "just", "about", "it", "its", "that", "this", "what",
    "which", "who", "whom", "these", "those",
];

// ============
// Search entry
// ============

#[derive(Debug, Clone)]
struct SearchEntry {
    index: usize,
    role: String,
    full_text: String,
    source_path: String,
}

impl SearchEntry {
    fn summary(&self) -> String {
        let truncated: String = self.full_text.chars().take(200).collect();
        let text = if truncated.len() < self.full_text.len() {
            format!("{truncated}...")
        } else {
            truncated
        };
        text.replace('\n', " ")
    }
}

// ===================
// Serialisable result
// ===================

#[derive(Debug, serde::Serialize)]
struct SearchResult {
    index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    snippet: Option<String>,
    match_count: usize,
    role: String,
    summary: String,
    source: String,
}

#[derive(Debug, serde::Serialize)]
struct SearchOutput {
    results: Vec<SearchResult>,
    total: usize,
    page: u32,
    total_pages: u32,
}

// ============
// BM25 scoring
// ============

struct Bm25Context {
    n: usize,
    avg_dl: f64,
    df: HashMap<String, usize>,
}

/// Regex compiled from a query term, keeping the original term for IDF lookup.
struct TermRegex {
    re: Regex,
    raw: String,
}

fn compile_term_res(terms: &[&str]) -> Vec<TermRegex> {
    terms
        .iter()
        .filter_map(|t| {
            // Escape to avoid metacharacters silently altering match semantics.
            // Terms that look like regex are already routed to regex_search.
            let escaped = regex::escape(t);
            safe_regex(&escaped).map(|re| TermRegex {
                re,
                raw: t.to_string(),
            })
        })
        .collect()
}

/// Precompute IDF and average doc length across all docs.
fn build_bm25_context(docs: &[String], term_res: &[TermRegex]) -> Bm25Context {
    let n = docs.len();
    let mut df = HashMap::new();
    let mut total_len = 0;

    for doc in docs {
        total_len += doc.split_whitespace().count();
        for tr in term_res {
            if tr.re.is_match(doc) {
                *df.entry(tr.raw.clone()).or_insert(0) += 1;
            }
        }
    }

    Bm25Context {
        n,
        avg_dl: total_len as f64 / n.max(1) as f64,
        df,
    }
}

/// BM25 score for a single doc against query terms.
fn bm25_score(doc: &str, term_res: &[TermRegex], ctx: &Bm25Context) -> f64 {
    let dl = doc.split_whitespace().count() as f64;
    let mut score = 0.0;

    for tr in term_res {
        let tf = term_freq(doc, &tr.re) as f64;
        if tf == 0.0 {
            continue;
        }

        let doc_freq = ctx.df.get(&tr.raw).copied().unwrap_or(0) as f64;
        // IDF: log((N - df + 0.5) / (df + 0.5) + 1)
        let idf = ((ctx.n as f64 - doc_freq + 0.5) / (doc_freq + 0.5) + 1.0).ln();
        // TF saturation with length normalization
        let tf_norm =
            (tf * (BM25_K + 1.0)) / (tf + BM25_K * (1.0 - BM25_B + (BM25_B * dl) / ctx.avg_dl));
        score += idf * tf_norm;
    }

    score
}

/// Search conversation logs: parse JSONL, extract text, rank via BM25 or
/// filter by regex, paginate, and output human-readable or JSON results.
pub fn execute(
    paths: Vec<String>,
    query: String,
    page: u32,
    json: bool,
    pi: bool,
) -> Result<ExitStatus> {
    let expanded = expand_paths(&paths);
    let (valid, invalid): (Vec<_>, Vec<_>) = expanded.iter().partition(|p| p.is_file());
    for path in &invalid {
        warn!("skipping {path:?}: not a regular file");
    }

    if valid.is_empty() {
        error!("no valid input files");
        return Ok(ExitStatus::Error);
    }

    // Collect all messages from all paths
    let mut all_messages: Vec<(usize, Message, String)> = Vec::new();
    let mut global_idx = 0usize;

    for path in &valid {
        let records = lex(path)?;
        let messages = if pi {
            pi::parse::parse(&records)
        } else {
            claude::parse::parse(records)
        };
        let source = path.to_string_lossy().to_string();
        for msg in messages {
            all_messages.push((global_idx, msg, source.clone()));
            global_idx += 1;
        }
    }

    // Build search entries
    let entries: Vec<SearchEntry> = all_messages
        .into_iter()
        .map(|(idx, msg, source)| SearchEntry {
            index: idx,
            role: msg.role.clone(),
            full_text: full_text(&msg),
            source_path: source,
        })
        .collect();

    let page_num = page.max(1);

    if query.trim().is_empty() {
        return paginate_all(&entries, page_num, json);
    }

    let raw_query = query.trim();

    if looks_like_regex(raw_query) {
        regex_search(&entries, raw_query, page_num, json)
    } else {
        bm25_search(&entries, raw_query, page_num, json)
    }
}

// ============
// Search modes
// ============

fn paginate_all(entries: &[SearchEntry], page: u32, json: bool) -> Result<ExitStatus> {
    let total = entries.len();
    let total_pages = total.div_ceil(RESULTS_PER_PAGE).max(1);
    let start = ((page as usize) - 1) * RESULTS_PER_PAGE;
    let page_entries = if start < total {
        let end = (start + RESULTS_PER_PAGE).min(total);
        &entries[start..end]
    } else {
        &[]
    };

    let results: Vec<SearchResult> = page_entries
        .iter()
        .map(|e| SearchResult {
            index: e.index,
            score: None,
            snippet: None,
            match_count: 0,
            role: e.role.clone(),
            summary: e.summary(),
            source: e.source_path.clone(),
        })
        .collect();

    if json {
        let output = SearchOutput {
            results,
            total,
            page,
            total_pages: total_pages as u32,
        };
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        print_human(&results, total, page, total_pages as u32);
    }

    Ok(ExitStatus::Success)
}

fn regex_search(
    entries: &[SearchEntry],
    raw_query: &str,
    page: u32,
    json: bool,
) -> Result<ExitStatus> {
    let regex = match safe_regex(raw_query) {
        Some(r) => r,
        None => {
            error!("invalid regex: {raw_query}");
            return Ok(ExitStatus::Failure);
        }
    };

    let hits: Vec<(&SearchEntry, String)> = entries
        .iter()
        .filter_map(|e| {
            let hay = format!("{} {}", e.role, e.full_text);
            if regex.is_match(&hay) {
                Some((e, hay))
            } else {
                None
            }
        })
        .collect();

    let total = hits.len();
    let total_pages = total.div_ceil(RESULTS_PER_PAGE).max(1) as u32;
    let start = ((page as usize) - 1) * RESULTS_PER_PAGE;
    let page_hits = if start < total {
        let end = (start + RESULTS_PER_PAGE).min(total);
        &hits[start..end]
    } else {
        &[]
    };

    let results: Vec<SearchResult> = page_hits
        .iter()
        .map(|(e, hay)| {
            let snippet = line_snippet(&e.full_text, &regex, 2);
            SearchResult {
                index: e.index,
                score: None,
                snippet,
                match_count: regex.find_iter(hay).count(),
                role: e.role.clone(),
                summary: e.summary(),
                source: e.source_path.clone(),
            }
        })
        .collect();

    if json {
        let output = SearchOutput {
            results,
            total,
            page,
            total_pages,
        };
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        print_human(&results, total, page, total_pages);
    }

    Ok(ExitStatus::Success)
}

fn bm25_search(
    entries: &[SearchEntry],
    raw_query: &str,
    page: u32,
    json: bool,
) -> Result<ExitStatus> {
    let raw_terms: Vec<&str> = raw_query.split_whitespace().collect();
    let terms = filter_stopwords(&raw_terms);
    let term_res: Vec<TermRegex> = compile_term_res(&terms);
    let snip_re = snippet_regex(&terms);

    // Pre-compute haystack per entry (role + full_text)
    let entries_with_hay: Vec<(&SearchEntry, String)> = entries
        .iter()
        .map(|e| (e, format!("{} {}", e.role, e.full_text)))
        .collect();

    let docs: Vec<String> = entries_with_hay.iter().map(|(_, h)| h.clone()).collect();
    let ctx = build_bm25_context(&docs, &term_res);

    // Score all entries, keeping match_count for later reuse
    let mut scored: Vec<(f64, &SearchEntry, usize)> = entries_with_hay
        .iter()
        .filter_map(|(e, hay)| {
            let mc = count_matches(hay, &term_res);
            if mc == 0 {
                return None;
            }
            let score = bm25_score(hay, &term_res, &ctx);
            Some((score, *e, mc))
        })
        .collect();

    // Sort by score descending
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    let total = scored.len();
    let total_pages = total.div_ceil(RESULTS_PER_PAGE).max(1) as u32;
    let start = ((page as usize) - 1) * RESULTS_PER_PAGE;
    let page_hits = if start < total {
        let end = (start + RESULTS_PER_PAGE).min(total);
        &scored[start..end]
    } else {
        &[]
    };

    let results: Vec<SearchResult> = page_hits
        .iter()
        .map(|(score, e, mc)| {
            let snippet = line_snippet(&e.full_text, &snip_re, 2);
            SearchResult {
                index: e.index,
                score: Some(*score),
                snippet,
                match_count: *mc,
                role: e.role.clone(),
                summary: e.summary(),
                source: e.source_path.clone(),
            }
        })
        .collect();

    if json {
        let output = SearchOutput {
            results,
            total,
            page,
            total_pages,
        };
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        print_human(&results, total, page, total_pages);
    }

    Ok(ExitStatus::Success)
}

fn print_human(results: &[SearchResult], total: usize, page: u32, total_pages: u32) {
    if total == 0 {
        println!("No matches");
        return;
    }

    println!("{total} matches  [page {page} of {total_pages}]\n");

    for r in results {
        print!("[{}]  {}", r.index, r.role);
        if let Some(score) = r.score {
            print!("  (score: {score:.2}, matches: {})", r.match_count);
        }
        println!();

        if let Some(ref snippet) = r.snippet {
            for line in snippet.lines() {
                println!("     {line}");
            }
        } else {
            println!("     {}", r.summary);
        }
        println!();
    }
}

/// Extract all searchable text from a message. Skips thinking blocks,
/// includes tool call names/args, tool result content, and bash execution
/// command/output.
fn full_text(msg: &Message) -> String {
    let mut parts: Vec<String> = Vec::new();

    for block in &msg.content {
        match block {
            ContentBlock::Text { text } => {
                parts.push(text.clone());
            }
            ContentBlock::ToolCall { name, input, .. } => {
                parts.push(name.clone());
                parts.push(input.to_string());
            }
            ContentBlock::ToolResult { name, content, .. } => {
                parts.push(name.clone());
                parts.push(content.clone());
            }
            ContentBlock::Thinking { .. } => {
                // Skip thinking — noise for search
            }
        }
    }

    // Also include bashExecution fields (Pi-mode only)
    if let Some(cmd) = &msg.command {
        parts.push(cmd.clone());
    }
    if let Some(out) = &msg.output {
        parts.push(out.clone());
    }

    parts.join(" ")
}

/// Extract ±context_lines around the first regex match.
fn line_snippet(text: &str, regex: &Regex, context_lines: usize) -> Option<String> {
    let lines: Vec<&str> = text.lines().collect();
    let mut match_idx = None;
    for (i, line) in lines.iter().enumerate() {
        if regex.is_match(line) {
            match_idx = Some(i);
            break;
        }
    }
    let match_idx = match_idx?;

    let start = match_idx.saturating_sub(context_lines);
    let end = (match_idx + context_lines + 1).min(lines.len());
    let slice = &lines[start..end];

    let mut parts: Vec<String> = Vec::new();
    if start > 0 {
        parts.push(format!("...({start} lines above)"));
    }
    parts.extend(slice.iter().map(|s| s.to_string()));
    if end < lines.len() {
        parts.push(format!("...({} lines below)", lines.len() - end));
    }
    Some(parts.join("\n"))
}

// =============
// Regex helpers
// =============

/// Try to compile `pattern` as a case-insensitive regex.
fn safe_regex(pattern: &str) -> Option<Regex> {
    Regex::new(&format!("(?i){pattern}")).ok()
}

/// Detect if the query contains regex metacharacters (→ single-pattern match).
fn looks_like_regex(query: &str) -> bool {
    query.chars().any(|c| {
        matches!(
            c,
            '|' | '*' | '+' | '?' | '(' | ')' | '[' | ']' | '\\' | '^' | '$' | '.'
        )
    })
}

/// Build a regex for snippet highlighting — alternation of escaped terms.
fn snippet_regex(terms: &[&str]) -> Regex {
    let alts: Vec<String> = terms.iter().map(|t| regex::escape(t)).collect();
    Regex::new(&format!("(?i)({})", alts.join("|"))).unwrap()
}

/// Remove stopwords, keep meaningful terms. Falls back to original terms if all
/// are filtered out.
fn filter_stopwords<'a>(terms: &[&'a str]) -> Vec<&'a str> {
    let meaningful: Vec<&str> = terms
        .iter()
        .filter(|t| {
            let lower = t.to_lowercase();
            !STOPWORDS.iter().any(|sw| sw == &lower.as_str()) && t.len() > 1
        })
        .copied()
        .collect();
    if meaningful.is_empty() {
        terms.to_vec()
    } else {
        meaningful
    }
}

/// Count distinct query terms that match the haystack.
fn count_matches(hay: &str, term_res: &[TermRegex]) -> usize {
    term_res.iter().filter(|tr| tr.re.is_match(hay)).count()
}

/// Count occurrences of a regex pattern in text.
fn term_freq(text: &str, pattern: &Regex) -> usize {
    pattern.find_iter(text).count()
}

#[cfg(test)]
mod tests {
    fn compile_terms(terms: &[&str]) -> Vec<TermRegex> {
        super::compile_term_res(terms)
    }

    use super::*;
    use rstest::rstest;
    use serde_json::json;

    // ========================
    // Stopword / regex helpers
    // ========================

    #[rstest]
    #[case("Read|Write", true)]
    #[case("*.rs", true)]
    #[case("hello?", true)]
    #[case("plain text", false)]
    #[case("user", false)]
    #[case("auth token", false)]
    fn test_looks_like_regex(#[case] input: &str, #[case] expected: bool) {
        assert_eq!(looks_like_regex(input), expected);
    }

    #[rstest]
    fn test_safe_regex_valid() {
        let re = safe_regex("hello").unwrap();
        assert!(re.is_match("HELLO world"));
    }

    #[rstest]
    fn test_safe_regex_invalid_regex_falls_back() {
        // An unmatched group is invalid regex
        let re = safe_regex("(unmatched");
        assert!(re.is_none());
    }

    #[rstest]
    fn test_filter_stopwords_removes_common() {
        let terms: Vec<&str> = vec!["the", "user", "is", "auth"];
        let filtered = filter_stopwords(&terms);
        assert!(filtered.contains(&"user"));
        assert!(filtered.contains(&"auth"));
        assert!(!filtered.contains(&"the"));
        assert!(!filtered.contains(&"is"));
    }

    #[rstest]
    fn test_filter_stopwords_fallback_when_all_filtered() {
        let terms: Vec<&str> = vec!["the", "is", "a"];
        let filtered = filter_stopwords(&terms);
        assert_eq!(filtered, terms);
    }

    #[rstest]
    fn test_filter_stopwords_removes_short() {
        let terms: Vec<&str> = vec!["x", "hi", "hello"];
        let filtered = filter_stopwords(&terms);
        assert!(!filtered.contains(&"x"));
        assert!(filtered.contains(&"hi"));
        assert!(filtered.contains(&"hello"));
    }

    // =========
    // full_text
    // =========

    #[rstest]
    fn test_full_text_user_message() {
        let msg = Message {
            role: "user".into(),
            content: vec![ContentBlock::Text {
                text: "hello world".into(),
            }],
            tool_call_id: None,
            tool_name: None,
            is_error: false,
            command: None,
            output: None,
            exit_code: None,
        };
        assert_eq!(full_text(&msg), "hello world");
    }

    #[rstest]
    fn test_full_text_assistant_with_tool() {
        let msg = Message {
            role: "assistant".into(),
            content: vec![
                ContentBlock::Text {
                    text: "looking...".into(),
                },
                ContentBlock::ToolCall {
                    id: "t1".into(),
                    name: "Read".into(),
                    input: json!({"file_path": "src/main.rs"}),
                },
            ],
            tool_call_id: None,
            tool_name: None,
            is_error: false,
            command: None,
            output: None,
            exit_code: None,
        };
        let text = full_text(&msg);
        assert!(text.contains("looking"));
        assert!(text.contains("Read"));
        assert!(text.contains("file_path"));
        assert!(text.contains("src/main.rs"));
    }

    #[rstest]
    fn test_full_text_tool_result() {
        let msg = Message {
            role: "tool_result".into(),
            content: vec![ContentBlock::Text {
                text: "fn main() {}".into(),
            }],
            tool_call_id: None,
            tool_name: Some("Read".into()),
            is_error: false,
            command: None,
            output: None,
            exit_code: None,
        };
        let text = full_text(&msg);
        assert!(text.contains("fn main() {}"));
    }

    #[rstest]
    fn test_full_text_skips_thinking() {
        let msg = Message {
            role: "assistant".into(),
            content: vec![
                ContentBlock::Thinking {
                    thinking: "hmm...".into(),
                    redacted: false,
                },
                ContentBlock::Text {
                    text: "visible".into(),
                },
            ],
            tool_call_id: None,
            tool_name: None,
            is_error: false,
            command: None,
            output: None,
            exit_code: None,
        };
        let text = full_text(&msg);
        assert!(!text.contains("hmm"));
        assert!(text.contains("visible"));
    }

    // ============
    // line_snippet
    // ============

    #[rstest]
    fn test_line_snippet_finds_match() {
        let text = "line1\nline2 TARGET line2\nline3\nline4\nline5";
        let re = Regex::new("(?i)TARGET").unwrap();
        let snippet = line_snippet(text, &re, 1).unwrap();
        assert!(snippet.contains("line1"));
        assert!(snippet.contains("TARGET"));
        assert!(snippet.contains("line3"));
    }

    #[rstest]
    fn test_line_snippet_no_match_returns_none() {
        let re = Regex::new("(?i)NOEXIST").unwrap();
        assert!(line_snippet("hello world", &re, 2).is_none());
    }

    #[rstest]
    fn test_line_snippet_above_truncation() {
        let text = (0..10)
            .map(|i| format!("line{i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let re = Regex::new("(?i)line9").unwrap();
        let snippet = line_snippet(&text, &re, 2).unwrap();
        assert!(snippet.contains("lines above"));
    }

    // ============
    // BM25 scoring
    // ============

    #[rstest]
    fn test_bm25_context_avg_dl() {
        let docs: Vec<String> = vec!["a b c".into(), "d e".into(), "f g h i".into()];
        let terms: Vec<&str> = vec!["a", "b"];
        let ctx = build_bm25_context(&docs, &compile_terms(&terms));
        // avg word count: (3 + 2 + 4) / 3 = 3
        assert_eq!(ctx.avg_dl, 3.0);
    }

    #[rstest]
    fn test_bm25_context_df() {
        let docs: Vec<String> = vec!["hello world".into(), "hello there".into(), "goodbye".into()];
        let terms: Vec<&str> = vec!["hello", "goodbye"];
        let ctx = build_bm25_context(&docs, &compile_terms(&terms));
        assert_eq!(ctx.df.get("hello"), Some(&2));
        assert_eq!(ctx.df.get("goodbye"), Some(&1));
    }

    #[rstest]
    fn test_bm25_score_orders_rare_term_higher() {
        let docs: Vec<String> = vec!["common common rare".into(), "common common common".into()];
        let terms: Vec<&str> = vec!["common"];
        let ctx = build_bm25_context(&docs, &compile_terms(&terms));
        // Doc with "common" x2 vs x3 — rare term "rare" only in doc 0
        // But BM25 with just "common": doc[1] has higher term freq
        let s0 = bm25_score(&docs[0], &compile_terms(&terms), &ctx);
        let s1 = bm25_score(&docs[1], &compile_terms(&terms), &ctx);
        // Doc with more occurrences of "common" should score higher
        assert!(s1 > s0);
    }

    #[rstest]
    fn test_bm25_score_rare_term_wins() {
        let docs: Vec<String> = vec![
            "common cat sat on mat".into(),
            "common rare_zircon sits alone".into(),
        ];
        let terms: Vec<&str> = vec!["common", "rare_zircon"];
        let ctx = build_bm25_context(&docs, &compile_terms(&terms));
        let s0 = bm25_score(&docs[0], &compile_terms(&terms), &ctx);
        let s1 = bm25_score(&docs[1], &compile_terms(&terms), &ctx);
        // "rare_zircon" has higher IDF than "common" (appears in fewer docs)
        assert!(s1 > s0);
    }

    // =============
    // count_matches
    // =============

    #[rstest]
    fn test_count_matches() {
        let terms: Vec<&str> = vec!["hello", "world", "nonexistent"];
        assert_eq!(count_matches("hello world", &compile_terms(&terms)), 2);
        assert_eq!(count_matches("goodbye", &compile_terms(&terms)), 0);
        assert_eq!(count_matches("HELLO", &compile_terms(&terms)), 1);
    }

    // =========
    // term_freq
    // =========

    #[rstest]
    fn test_term_freq() {
        let re = safe_regex("hello").unwrap();
        assert_eq!(term_freq("hello HELLO Hello", &re), 3);
        assert_eq!(term_freq("none", &re), 0);
    }

    // =============
    // snippet_regex
    // =============

    #[rstest]
    fn test_snippet_regex_matches_any_term() {
        let terms: Vec<&str> = vec!["hello", "world"];
        let re = snippet_regex(&terms);
        assert!(re.is_match("hello there"));
        assert!(re.is_match("the world"));
        assert!(!re.is_match("goodbye"));
    }

    // =============================
    // filter_stopwords (additional)
    // =============================

    #[rstest]
    fn test_filter_stopwords_case_insensitive() {
        let terms: Vec<&str> = vec!["The", "User", "IS", "token"];
        let filtered = filter_stopwords(&terms);
        assert!(!filtered.contains(&"The"));
        assert!(!filtered.contains(&"IS"));
        assert!(filtered.contains(&"User"));
        assert!(filtered.contains(&"token"));
    }
}
