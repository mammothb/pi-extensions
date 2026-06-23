# Hashline Edit Grammar

You are editing files using **hashline anchoring**. Every file you read has a `¶PATH#TAG` header and `HASH│content` line prefixes. Every edit you make must include the header so the tool can validate you're working against the version you read.

## Two Edit Formats

The edit tool accepts two formats:

### JSON Format (preferred)
```json
{"path": "src/greet.ts", "patch": [
  {"old_range": ["1d2e", "1d2e"], "new_lines": ["  console.log(`Hello, ${name}`);"]}
]}
```
- `path` — file to edit
- `patch` — array of edit objects, each with:
  - `old_range`: `[start, end]` — 4-char hex HASH anchors from read output, or line numbers
  - `new_lines`: `["..."]` — replacement content, one string per line. Use `[]` to delete.
- All edits in a single call apply against the same pre-edit file snapshot

### Text Grammar (legacy — prefer JSON format above)
```
¶PATH#TAG
replace N..M:
+TEXT
```

## Section Headers

Every file section starts with `¶PATH#TAG`. Copy the entire header from the `read` or `grep` output. **The tag is REQUIRED** — there is no hashless form. To create a new file, use the `write` tool.

## Operations

```
replace N..M:         Replace original lines N–M with the body rows below.
                      Single line: `replace N..N:`.
                      Body length is irrelevant — replacing 1 line with 10 is still `replace N..N:`.

delete N..M           Delete original lines N–M. No body, no colon.
                      Single line: `delete N`.

insert before N:      Insert body rows immediately before line N.
insert after N:       Insert body rows immediately after line N.
insert head:          Insert body rows at the very start of the file.
insert tail:          Insert body rows at the very end of the file.

replace block N:      Replace the whole syntactic block that BEGINS on line N —
                      its header line through its closing line — resolved with
                      tree-sitter at apply time. Body rows below. Point N at the
                      line that OPENS the construct (the `if`/`function`/`def`/
                      `{`-bearing line), not a closing `}` or a blank line.

delete block N        Delete the whole syntactic block that BEGINS on line N.
                      No body, no colon.
```

## Body Rows

Body rows appear only under a `:` header. Every body row is:

```
+TEXT     Add a new literal line TEXT, verbatim. Leading whitespace is kept.

## Examples

Read returns (note `HASH│content` line prefixes):
```
¶src/greet.ts#A1B200
aB3f│function greet(name: string) {
1d2e│  console.log("Hello, " + name);
f09a│}
```

JSON format — replace line identified by hash `1d2e`:
```json
{"path": "src/greet.ts", "patch": [
  {"old_range": ["1d2e", "1d2e"], "new_lines": ["  console.log(`Hello, ${name}`);"]}
]}
```
4. **One hunk per range.** The body is the final desired content, never an old/new pair. To change lines 2 and 5 while keeping 3–4, issue two separate hunks.

5. **Never format code with this tool.** Use the project's formatter (e.g. `bash: npm run format`) for reordering imports, re-indenting, or mechanical restyling.

6. **Block ops are resolved at apply time.** A `replace block N:` or `delete block N` is resolved by tree-sitter against the current file content — the block's exact line span is determined from the live file, not from pre-edit memory.

7. **Point at the opening line.** `replace block N:` resolves the block that *begins* on line N. Point N at the line that OPENS the construct (the `if`, `function`, `def`, or `{`-bearing line). A closing `}` or a blank line resolves to nothing because no block begins there.

8. **Block resolution is language-aware.** Supported languages: TypeScript (.ts/.tsx), JavaScript (.js/.jsx/.mjs/.cjs), Python (.py/.pyw), YAML (.yaml/.yml), and optionally Bash, JSON, TOML, CSS, HTML, Rust, Go (when installed).

## Anti-Patterns (WRONG)
```
# WRONG — empty replace to delete. Use delete 4 instead.
replace 4..4:

# WRONG — range describes post-edit size. Use replace 1..1: (body length is irrelevant).
replace 1..2:
+function greet(name: string) {

# WRONG — `-` rows do not exist. The range deletes; the body is only new content.
replace 3..3:
    old line
-   removed line
+   new line

# WRONG — point at closing delimiter. Point at the line that OPENS the block.
replace block 3:    ← line 3 is `}` — resolves to nothing

# RIGHT
replace 3..3:
+   new line
```

## On Stale-Tag Rejection

If the edit tool says the tag is stale ("file changed between read and edit"), re-`read` the file to get the current tag and hash anchors. Never stack more edits onto stale anchors.
