# Hashline Edit Grammar

You are editing files using **hashline anchoring**. Every file you read has a `¶PATH#TAG` header. Every edit you make must include that same header so the tool can validate you're working against the version you read.

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
          Use `+` alone to add a blank line.
```

There is NO other body row kind. **Never write `-old` rows or bare context lines.** To keep a line, leave it out of every range. To insert a literal line starting with `-`, prefix it: `+-text`.

## Critical Rules

1. **Re-ground after every edit.** Each applied edit mints a fresh `#TAG` and renumbers the file. The tag and line numbers you just used are dead. Take the next edit's `¶PATH#TAG` and line numbers from the edit response or a fresh `read`, never from pre-edit memory.

2. **Ranges are tight.** Cover only lines whose content actually changes. Never widen a range to swallow an unchanged signature, brace, or statement. A stale single-line replace corrupts one line; a stale block replace shreds everything.

3. **The body is the final content.** Only `+TEXT` rows under a `:` header. The range does the deleting — never include both old and new lines.

4. **One hunk per range.** The body is the final desired content, never an old/new pair. To change lines 2 and 5 while keeping 3–4, issue two separate hunks.

5. **Never format code with this tool.** Use the project's formatter (e.g. `bash: npm run format`) for reordering imports, re-indenting, or mechanical restyling.

6. **Block ops are resolved at apply time.** A `replace block N:` or `delete block N` is resolved by tree-sitter against the current file content — the block's exact line span is determined from the live file, not from pre-edit memory.

7. **Point at the opening line.** `replace block N:` resolves the block that *begins* on line N. Point N at the line that OPENS the construct (the `if`, `function`, `def`, or `{`-bearing line). A closing `}` or a blank line resolves to nothing because no block begins there.

8. **Block resolution is language-aware.** Supported languages: TypeScript (.ts/.tsx), JavaScript (.js/.jsx/.mjs/.cjs), Python (.py/.pyw), YAML (.yaml/.yml), and optionally Bash, JSON, TOML, CSS, HTML, Rust, Go (when installed).

## Examples

Read returns:
```
¶src/greet.ts#A1B200
1:function greet(name: string) {
2:  console.log("Hello, " + name);
3:}
```

Replace line 2:
```
¶src/greet.ts#A1B200
replace 2..2:
+  console.log(`Hello, ${name}`);
```

Insert after line 1:
```
¶src/greet.ts#A1B200
insert after 1:
+  if (!name) name = "world";
```

Delete line 2:
```
¶src/greet.ts#A1B200
delete 2
```

Add header and footer:
```
¶src/greet.ts#A1B200
insert head:
+// Auto-generated
insert tail:
+export default greet;
```

Replace a whole function block (Python):
```
¶greet.py#A1B200
replace block 1:
+def greet(name):
+    print(f"Hello, {name}")
```

Delete an inner if-statement:
```
¶src/module.ts#C3D400
delete block 2
```

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

If the edit tool says the tag is stale ("file changed between read and edit"), re-`read` the file to get the current tag and line numbers. Never stack more edits onto stale numbers.
