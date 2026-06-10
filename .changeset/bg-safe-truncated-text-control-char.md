---
"@mammothb/pi-shared": patch
---

Fixed a `noControlCharactersInRegex` lint error in `BgSafeTruncatedText` by extracting the ANSI escape character into a constant and building the regex dynamically with `new RegExp()` instead of embedding `\x1b` in a regex literal.
