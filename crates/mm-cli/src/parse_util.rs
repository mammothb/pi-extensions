use serde_json::Value;

/// Extract a required string field. Returns `None` if missing or empty -
/// the caller uses `?` to drop the enclosing content block or message.
pub fn required_str(v: &Value, key: &str) -> Option<String> {
    let s = v.get(key).and_then(Value::as_str)?;
    if s.is_empty() {
        None
    } else {
        Some(s.to_string())
    }
}

/// Extract an optional string field. Returns `None` if missing, but
/// preserves empty strings (caller can `.filter()` them out if needed).
pub fn optional_str(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(String::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;
    use serde_json::json;

    #[rstest]
    #[case::nonempty(json!({"key": "hello"}), Some("hello".into()))]
    #[case::empty_string(json!({"key": ""}), None)]
    #[case::missing_key(json!({"other": "val"}), None)]
    #[case::number(json!({"key": 42}), None)]
    #[case::null_val(json!({"key": null}), None)]
    #[case::bool_val(json!({"key": true}), None)]
    #[case::object_val(json!({"key": {"nested": "v"}}), None)]
    fn required_str_behaves(#[case] input: Value, #[case] expected: Option<String>) {
        assert_eq!(required_str(&input, "key"), expected);
    }

    #[rstest]
    #[case::nonempty(json!({"key": "hello"}), Some("hello".into()))]
    #[case::empty_preserved(json!({"key": ""}), Some("".into()))]
    #[case::missing_key(json!({"other": "val"}), None)]
    #[case::wrong_type(json!({"key": 99}), None)]
    fn optional_str_behaves(#[case] input: Value, #[case] expected: Option<String>) {
        assert_eq!(optional_str(&input, "key"), expected);
    }
}
