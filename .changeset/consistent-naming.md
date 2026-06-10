---
"@mammothb/pi-ask": patch
"@mammothb/pi-eval": patch
"@mammothb/pi-ghsearch": patch
"@mammothb/pi-memory": patch
"@mammothb/pi-permissions": patch
"@mammothb/pi-shared": patch
"@mammothb/pi-toast": patch
"@mammothb/pi-webfetch": patch
"@mammothb/pi-websearch": patch
---

Naming consistency pass across all packages:

- `IEditorAdapter` → `EditorAdapter` (drop lone `I` prefix)
- `QuestionT`/`ResultT`/`OptionT` → `Question`/`AskResult`/`Option` (drop `T` suffix on types; schema values use `Schema` suffix)
- `GhSearchParamsT` → `GhSearchParams`, `GhSearchParams` → `GhSearchParamsSchema`
- `AskParams` → `AskParamsSchema`
- `private` fields → `#` private fields in `AskComponent` and `ApprovalCache`
- `onOther` → `isOnOther` (boolean prefix convention)
- `mergeConfigs` → `mergeConfig` (singular)
- `err` → `err` in all catch blocks, `error` → `err` in webfetch/providers
- `filepath` → `filePath` (camelCase)
- `allOptions` → `getOptions` (misleading name: not a predicate)
- `backend.remember()` → `backend.retain()`, `RememberParams` → `RetainParams`
- `checkShutdownHealth` → `inspectShutdownState`, `ShutdownHealth` → `ShutdownState`
- `InputContext` → `InputDeps`
- `context` → `ctx` in all `renderCall`/`renderResult` signatures
