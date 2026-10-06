# 01 — Exact tool-change capture and semantic scope adapters

## Goal and teammate ownership
Runtime-capture teammate owns the tool/source-analysis workstream. It delivers typed capture from successful direct edits and a harness-owned TS/JS parser adapter. It does NOT call Jev, append events, manage finding episodes, or implement settings UI.

## Verified existing seams
- packages/core/src/tools/tool.ts:68-75,146-165,186-210 — main-owned success metadata and optional invocation/run flag from section 00.
- packages/harness/src/tools/builtin/write.ts:58-77 — guarded stat and atomic write, success output unchanged.
- packages/harness/src/tools/builtin/edit.ts:42-81,84-121,150-183 — create/replace helpers already have original and replacement text under guard.
- packages/harness/src/tools/builtin/multi-edit.ts:68-112 — original raw read, sequential replacements, single final commit.
- packages/harness/src/files/atomic-write.ts:17-28,39-50 and path-lock.ts:3-28 — existing symlink commit and process-local lock; captured evidence is not OS-wide isolation.
- packages/harness/src/tools/register-tools.ts:98-117 — existing constructors need no new registry route.
- packages/harness/src/tools/builtin/unified-diff.ts:150-164 — owned exact-scope diff generator. Reuse renderUnifiedDiff; scope-level oldLabel uses before path; it is exact-content input, not historic UI evidence. Existing edit/multi_edit output remains unchanged and uses the same routine for its display diff.
- packages/harness/src/tools/builtin/edit.ts:116-117 and multi-edit.ts:108 — tool result diffs are LF-normalized display; do not substitute them for review diff/state.
- packages/harness/src/execution/routed-filesystem.ts:26-64,84-88 and composition/sandbox-binding.ts:176-203 — use thread-aware AgentFileSystemPort, never host fs for Docker paths.
- packages/harness/package.json:17-34 and root package.json:30,34 — TypeScript parser must be a declared harness runtime dependency matching root pin 6.0.3; main owns manifest/lock edits.

## Owned files
Modify only builtin `write.ts`, `edit.ts`, `multi-edit.ts` and their specifically related sibling capture tests. Create `packages/harness/src/quality/source/{capture-text,typescript-parser,scope-adapter,scope-matching,scope-diff,index}.ts` plus sibling `__tests__`. New files <=300 lines. Capture implementation may extract existing helper functions into new focused tool-local modules only when existing builtins approach the 300-line limit; do not rewrite unrelated behavior. Main owns core types/exports, ToolInvocation forwarding, dispatcher, package/lock and binary wiring; the review teammate owns siblings under quality excluding source/.

## Capture changes
Use `captureFileChanges` flag supplied through ToolRun. When false/absent, no extra before-content read, metadata generation or quality behavior: current tool result/diff/modelText remains byte-equivalent.

- Write: under existing lock, stat as today, best-effort old-content read only when capture requested and an existing regular file is known, commit atomically, then attach `{path,before,after}`. Existing unreadable contents produce `fileChangeFaults`, NOT null-before and NOT failure of the successful overwrite. Creation uses before:null. Empty existing file uses before:''.
- Edit: pass optional capture flag into the two helpers, add metadata after commit, reuse exact raw existing/replaced strings. Never generate metadata for failed/no-op replacement or failed rename. Existing required reads remain required tool behavior, not advisory behavior.
- Multi-edit: emit ONE aggregate raw-before/final-after change only after all replacements and commit succeed. No review of intermediate array entries.
- Strict capture with exact on/off parity via ONE backend-owned read: when capture is requested for a source file, tools call the port's new `readTextForEdit({path,threadId})` (main-owned addition to AgentFileSystemPort with Local/Docker/Routed implementations) — one byte read returning `{text, strict}`, where `text` is that backend's existing lossy decode (local keeps BOM, Docker strips it) used unchanged by the operation, and `strict` is the fatal-decode result or null. The operation uses `text` exactly as today; strict null yields an InvalidText capture fault. Write overwrite still commits exact requested content on any capture fault. Identical non-UTF-8 input produces identical edit results with quality on and off. Captured before is exact disk text; the operation's text is whatever that backend already produced — both come from the same single read. BOM behavior differs between backends only as it already does; tests on both backends pin that. No behavior change to read-before-write guards, modes, symlinks or diagnostics. Preserve BOM, CRLF and absent final newline. Existing file writes continue even when advisory capture is unavailable.
- Capture identity/provenance: tools fill CapturedFileChange.path/before/after only. The dispatcher stamps threadId/runId; the engine computes project-relative path and workspace namespace (section 00) and passes them into the parser — tools cannot compute namespaces because ToolRun carries no events.
- No model, AST, artifact writing or logging under the file lock. Capture is the tool's source read + committed payload; external editors/shells/symlink aliases can still race outside this process-local guard.

## Source adapter contract
Define a harness-local `QualitySourceAdapter` interface returning every changed enclosing supported scope and coverage diagnostics. The parser performs NO policy selection: it emits module/class/method/function scopes with parentScopeId containment, and policies select from the whole preparation via their selectScopes contract. A changed nested construct still carries structural parent relationships; identity uncertainty is explicitly scoped. No ad hoc SRP-specific filtering anywhere in the parser. Export a versioned implementation from source/index.ts. Required external signature:

```ts
prepareQualityScopes(args: {
  change: CapturedFileChange
  projectDirectory: string
  workspaceNamespace: string
  previousScopes: readonly QualityScopeIdentity[]
}): QualityScopePreparation

projectDirectory/workspaceNamespace are engine-computed inputs, never derived from the change by the tools. Every changed enclosing scope (module/class/method/function) gets before/after/diff and matching parentScopeId/line ranges; selection of which to review is policy-owned.
```
QualityScopePreparation is `{scopes: readonly QualityScope[], skipped: readonly QualityCoverageDiagnostic[]}`. Core owns those records (section 00); parser owns implementation. It must not read current disk. Before/after inputs are immutable captured text, so later writes or placement changes cannot change the review.

Use the TypeScript compiler parser with explicit ScriptKind TS/TSX/JS/JSX. Emit ALL changed enclosing constructs with containment: module, classes, methods (kind Method, parentScopeId of the class), named functions and named arrow/function expressions — no selection here and the parser never reports NoSupportedScope itself. Which scopes a policy reviews is policy-owned (`selectScopes` over the whole preparation); the SRP rule in section 04 (outermost changed class wins; otherwise nearest named function to each changed range not inside a selected class) is NOT parser logic. When no enabled policy selects any scope — including import-only edits, which always have an enclosing Module scope — the ENGINE records the NoSupportedScope coverage outcome. No invented whole-file fallback.

Initial extensions: .ts/.tsx/.js/.jsx/.mts/.cts/.mjs/.cjs, excluding declaration .d.ts/.d.mts/.d.cts. Other languages stay unsupported while the adapter registry allows future additions. No OpenTUI/TUI import or tree-sitter renderer reuse.

Detect syntactic uncertainty through a PUBLIC TypeScript API, not an untyped access to internal parseDiagnostics. Prefer public parsing/transpile diagnostics with no filesystem/typechecker; if that public route requires an in-memory compiler host, implement it locally and benchmark. Do not use `as any` or suppress errors. This API/dependency/binary compatibility is a first workstream verification checkpoint, not a reason to claim a regex is an AST.

Represent changed source with exact captured strings and fresh scope diffs. Use AST UTF-16 offsets consistently with JS strings; derive line/column metadata in code, never ask Jev to count lines. Supply only relevant import declarations and member/evidence labels needed to understand each emitted scope, not arbitrary full-repo context. Method scopes carry their parent class identity and member labels. Policy selectScopes — not this adapter — decides which complete scopes are judged. No silent clipping of a class/function: too-large complete scope is reported unreviewed.

## Stable scope identity
- IDs are independent of current source hash and line numbers.
- Match before/after by `(workspace namespace,relative path,kind,qualified name)` first.
- Carry identity through a unique pure rename using normalized structural/body fingerprint, and through a uniquely mapped declaration span using the actual diff.
- Ambiguous rename/split/merge matching emits identity-uncertain coverage; do not generate repeated fresh findings from guessed identity.
- Scope deletion yields after:null so the lifecycle can retire the deleted scope without model inference. Creation yields before:null.
- Evidence candidates have stable declaration IDs and names; preserve them through uniquely matched rename/line-shift. Selected evidence must always refer to a supplied candidate.
- Parser adapter version and scope hashes enter evaluation-cache identity, NOT finding identity.

## Coverage boundaries
Initial coverage is direct built-in write/edit/multi_edit only. Bash/background/services/MCP/external edits are not attributed and are visibly outside coverage. No filesystem watcher/Git-diff claim of comprehensive review. Source paths outside the active project, invalid/binary input, excluded declaration files, invalid syntax and oversized input are skipped explicitly. Capture optional dataset examples through the review engine, not here.

## Validation
From packages/harness:
- `bun run typecheck`
- `bun run test src/tools/builtin/__tests__ src/quality/source/__tests__`
- `bun run test src/execution/__tests__/routed-filesystem.spec.ts`
- `ATLAS_LIVE_DOCKER=1 bun run test src/execution/docker/__tests__/docker-filesystem.spec.ts` only when Docker is available in isolated implementation environment.
Main will additionally build TUI and serve binaries after integrating the parser.

Tests must prove OFF byte-equivalence/no extra reads; exact create/overwrite/replaceAll/multi-edit snapshots; failure emits no change; advisory before-read failure preserves write success; CRLF/BOM/Unicode/newline; adjacent locked writes observe adjacent states; routing uses thread backend; class/functions/arrows/nesting/TSX/JSX; stable IDs across line shifts/rename; deletion; parse errors; ambiguous matching; independent changed scopes; entire-file creation; no stale current-disk rereads.

## Handoff
Deliver exports, owned tests, parser version, coverage matrix and any unresolved public TypeScript API/binary issue. Do not wire the dispatcher or merge until main's contract commit and the integration tests are ready. Separate teammate worktree from origin/main; source edits remain disjoint from review/eval/UI workstreams.
