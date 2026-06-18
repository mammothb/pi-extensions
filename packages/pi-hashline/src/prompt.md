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

## Examples

Read returns:
```
¶src/greet.ts#A1B2
1:function greet(name: string) {
2:  console.log("Hello, " + name);
3:}
```

Replace line 2:
```
¶src/greet.ts#A1B2
replace 2..2:
+  console.log(`Hello, ${name}`);
```

Insert after line 1:
```
¶src/greet.ts#A1B2
insert after 1:
+  if (!name) name = "world";
```

Delete line 2:
```
¶src/greet.ts#A1B2
delete 2
```

Add header and footer:
```
¶src/greet.ts#A1B2
insert head:
+// Auto-generated
insert tail:
+export default greet;
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

# RIGHT
replace 3..3:
+   new line
```

## On Stale-Tag Rejection

If the edit tool says the tag is stale ("file changed between read and edit"), re-`read` the file to get the current tag and line numbers. Never stack more edits onto stale numbers.
