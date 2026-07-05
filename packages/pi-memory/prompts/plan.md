---
description: Break attached proposal into verifiable implementation phases
argument-hint: "[feature-name]"
---
Read the proposal attached above. Break it into verifiable implementation phases so I can manually verify after each phase to ensure implementation correctness.
Write to PLAN-${1:-<feature>}.md for me to review.

Each phase must include:
- **Title:** Phase <number>: <description>
- **Files:** <paths affected>
- **What:** <concrete steps>
- **Verify:** <command or observable behavior, e.g. `npx tsc --noEmit`, `cargo test -p ...`, `git status # should show deletions only`>

Use verbs like [Implement | Fix | Refactor | Add | Create | Build | Remove | Update | Migrate | Deploy | Test] in <description>.
