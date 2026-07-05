use std::sync::LazyLock;

use regex::Regex;

/// Regex tokenizer `_TOK_RE`.
/// Groups letters, groups digits, emits single symbols, matches whitespace
/// (but whitespace is not counted).
static TOK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[a-zA-Z]+|[0-9]+|[^\sa-zA-Z0-9]|\s+").unwrap());

/// Count approximate tokens in text using regex tokenizer.
/// Whitespace tokens are excluded from the count.
pub fn count_tokens(text: &str) -> usize {
    TOK_RE
        .find_iter(text)
        .filter(|m| !m.as_str().trim().is_empty())
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    #[rstest]
    fn empty_string() {
        assert_eq!(count_tokens(""), 0);
    }

    #[rstest]
    fn single_word() {
        assert_eq!(count_tokens("hello"), 1);
    }

    #[rstest]
    fn two_words() {
        assert_eq!(count_tokens("hello world"), 2);
    }

    #[rstest]
    fn code_snippet() {
        // fn=1, main=1, (=1, )=1, {=1, }=1 → 6
        assert_eq!(count_tokens("fn main() { }"), 6);
    }

    #[rstest]
    fn digits_grouped() {
        // 123=1, 456=1 → 2
        assert_eq!(count_tokens("123 456"), 2);
    }

    #[rstest]
    fn mixed_text_and_digits() {
        // fix=1, bug=1, #=1, 42=1 → 4
        assert_eq!(count_tokens("fix bug #42"), 4);
    }

    #[rstest]
    fn only_whitespace() {
        assert_eq!(count_tokens("   \n\t  "), 0);
    }

    #[rstest]
    fn unicode_accented_chars_split() {
        // [a-zA-Z]+ is ASCII-only. "café" → "caf" + "é" = 2.
        // "résumé" → "r" + "ésumé"... actually:
        // "café" → "caf" (letters) + "é" (symbol, not a-zA-Z0-9) → 2
        // "résumé" → "r" (letters) + "ésumé" → wait:
        // r=letter, é=symbol, s=letter, u=letter, m=letter, é=symbol
        // So tokens: r, é, sum, é → 4
        // Total: caf + é + r + é + sum + é = 6
        // Actually let's trace: "café résumé"
        // Regex alternation tries in order: letters, digits, symbols, whitespace
        // "caf" matches [a-zA-Z]+, then "é" matches [^\sa-zA-Z0-9],
        // space matches \s+, "r" matches [a-zA-Z]+, "é" matches symbol,
        // "sum" matches [a-zA-Z]+, "é" matches symbol
        // → 6 non-whitespace tokens
        assert_eq!(count_tokens("café résumé"), 6);
    }

    #[rstest]
    fn symbols_only() {
        // each symbol is one token
        assert_eq!(count_tokens("!@#$"), 4);
    }

    #[rstest]
    fn dots_and_slashes() {
        // src=1, /=1, main=1, .=1, rs=1 → 5
        assert_eq!(count_tokens("src/main.rs"), 5);
    }

    #[rstest]
    fn newlines_counted_as_whitespace() {
        // hello=1, world=1
        assert_eq!(count_tokens("hello\nworld"), 2);
    }

    #[rstest]
    fn json_like_text() {
        // "file_path" → "file" (letters) + "_" (symbol) + "path" (letters) → 3 tokens
        // ": " → ":" + whitespace
        // "src/main.rs" → "src" + "/" + "main" + "." + "rs" → 5 tokens
        // Total: file=1, _=1, path=1, :=1, src=1, /=1, main=1, .=1, rs=1 → 9
        assert_eq!(count_tokens(r#"file_path: src/main.rs"#), 9);
    }
}
