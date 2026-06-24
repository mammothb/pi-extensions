# Hashline Edit Grammar

You are editing files using **hashline anchoring**. Every file you read has a `¶PATH#TAG` header and `HASH│content` line prefixes. Every edit you make must reference anchors from the version you read.

## Edit Format

The edit tool uses a JSON format with a `path` and `patch` array:

```json
{"path": "src/greet.ts", "patch": [
  {"old_range": ["1d2e", "1d2e"], "new_lines": ["  console.log(`Hello, ${name}`);"]}
]}
```

- `path` — file to edit
- `patch` — array of edit objects, each with:
  - `old_range`: `[start, end]` — 4-char hex HASH anchors (from read/grep output), or 1-indexed line numbers
  - `block`: `N` — (alternative to `old_range`) line number of an opening construct (function, if, class). Replaces the entire syntactic block determined by tree-sitter.
  - `new_lines`: `["..."]` — replacement content, one string per line. Use `[]` to delete.
- All edits in a single call apply against the same pre-edit file snapshot
### Block Edits

Use `block` instead of `old_range` to replace or delete an entire syntactic block (function, if-statement, class, etc.). Point `block` at the line that OPENS the construct — the `{`-bearing line, `def`, `function`, `if`, etc.

```json
{"path": "src/greet.ts", "patch": [
  {"block": 1, "new_lines": ["function greet(name: string) {", "  return `Hello, ${name}`;", "}"]}
]}
```

Supported languages: TypeScript (.ts/.tsx), JavaScript (.js/.jsx/.mjs/.cjs), Python (.py/.pyw), YAML (.yaml/.yml).

## Section Headers

Every file section starts with `¶PATH#TAG`. Copy the entire header from the `read`, `grep`, or `write` output. **The tag is REQUIRED** — there is no hashless form. To create a new file, use the `write` tool.

## Examples

Read returns (note `HASH│content` line prefixes):
```
¶src/greet.ts#A1B200
aB3f│function greet(name: string) {
1d2e│  console.log("Hello, " + name);
f09a│}
```

Replace line identified by hash `1d2e`:
```json
{"path": "src/greet.ts", "patch": [
  {"old_range": ["1d2e", "1d2e"], "new_lines": ["  console.log(`Hello, ${name}`);"]}
]}
```

Delete a range using empty `new_lines`:
```json
{"path": "src/greet.ts", "patch": [
  {"old_range": ["aB3f", "f09a"], "new_lines": []}
]}
```

Replace multiple non-adjacent lines in one call:
```json
{"path": "src/greet.ts", "patch": [
  {"old_range": [2, 2], "new_lines": ["  const msg = `Hello, ${name}`;"]},
  {"old_range": [5, 5], "new_lines": ["  return msg;"]}
]}
```

## Rules

1. **Hash anchors come from read/grep output.** Copy the 4-character hex hash from the `HASH│` prefix of each line. Do not guess or construct anchors.

2. **Line numbers start at 1.** If you use line numbers in `old_range`, they refer to the file as you read it.

3. **After every edit, the file gets a new tag and hash anchors.** Always take the next edit's anchors from the edit response or a fresh read — never reuse old tags from a previous edit.

4. **One hunk per range.** To change lines 2 and 5 while keeping 3–4, issue two separate edits in the `patch` array. Untouched lines are absent from every range.

5. **Never format code with this tool.** Use the project's formatter (e.g. `bash: npm run format`) for reordering imports, re-indenting, or mechanical restyling.

## Anti-Patterns (WRONG)

```
# WRONG — copying the HASH│ prefix into new_lines.
# old_range uses hashes; new_lines uses literal content only.
{"old_range": ["1d2e", "1d2e"], "new_lines": ["1d2e│  console.log(`Hello`);"]}

# WRONG — using hashes as a range separator (aB3f..1d2e).
# old_range is always [start, end] — two separate anchors.
{"old_range": ["aB3f..1d2e"], "new_lines": ["replacement"]}

# RIGHT
{"old_range": ["1d2e", "1d2e"], "new_lines": ["  console.log(`Hello, ${name}`);"]}
```

## On Stale-Tag Rejection

If the edit tool says the tag is stale ("file changed between read and edit"), re-`read` the file to get the current tag and hash anchors. Never stack more edits onto stale anchors.
