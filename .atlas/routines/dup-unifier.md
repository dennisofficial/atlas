# Dup unifier record

## Unified

- `formatTokens` (k/m/b): tui `ui/theme.ts` and web `threads/panel/details/details-model.ts` now use `@dltech/atlas-client/crew` (`packages/client/src/crew/readout.ts`).
- `clipText` (`slice(0, limit - 1)…`): core `pr-event-block`, `loop-watch`, classifier `adjudicate`, `verdict`, `from-events` and client `pr-event-line` now use `@dltech/atlas-core` (`packages/core/src/text/clip-text.ts`).
- Shell/service name "trimmed description, else the command": plain form (tui `shellNameLabel`, `serviceNameLabel`, client rewind `shellLabelOf`) → core `shellName`; quoted form (`"name"` else `` `command` ``; client `shell-ended-line`, `service-ended-line`, `shell-lines`) → core `quotedShellName` (`packages/core/src/shells/label.ts`).
- Context window label (`200k` / `1.5M`): web `threads/data/model-options.ts` and mobile `composer/model-options.ts` now use core `contextWindowLabel` (`packages/core/src/models/context-window-label.ts`). Mobile's effort ladder and labels now come from core `EFFORT_LADDER` / `EFFORT_RUNG_LABEL`.
- `oneLine` (`\s+` → space, trim): also control `session-summary`, client `session-rewind`, tui `services-model`, `rewind-model`, `transcript-peek`, quality `typescript-parser`, api `agent-tools/grep`; tui `store/sidebar-text.ts`, `sidebar/crew.tsx`, `lost-children-model.ts`, `lost-shells-model.ts`, `shells-model.ts`, web `details/crew-model.ts`, `data/processes-model.ts` and core `shells/label.ts`, `shells/fallback-shell-name.ts`, `agents/name.ts`, `agents/label.ts`, `naming/session-title.ts`, `classifier/verdict.ts` now use `@dltech/atlas-core` (`packages/core/src/text/one-line.ts`).

## Ruled out (intentional divergence — do not re-investigate)

- `packages/ui/src/ai/context.tsx` `formatTokens` (`1.0M`, no billions): `packages/ui` has no Atlas imports by design, and its output differs. Folding it in is a product change, not a dedupe.
- Relative time: web `settings/data/shared/relative-time.ts` (7-day weeks, years, `—` for invalid input) and prototype `new-project-repos.ts` (no week tier) differ on ages callers actually hit.
- `clip` variants `core/compaction/render-range.ts` (keeps `limit` chars), `core/web/render.ts` (trimEnd) and `client/transcript/tools/reading.ts` (code-point safe) do different jobs.
- `oneLine` in `core/memory/index-render.ts` (newlines only, no trim) does a different job from the `\s+` collapsers.
- `\s+` folders that cannot call core: `packages/db` `transaction-deadline.ts` (no core dependency), `packages/ui` fixtures (no Atlas imports), `packages/github` query-count spec (no trim, test-only).
- Byte formatters (tui `transfer-meter`, tui `push-text`, web `skill-format`, ui `queued-message-ops`): units, divisors and rounding all differ, so no single copy preserves every caller's output.
- Agent status labels (web `crew-panel`, client `readout` `STATE_LABEL`, client `tools/agents` `STOP_NOTE`): different vocabularies on purpose.
- Shell-name lookalikes that do a different job: web `preview-ports.ts` `labelOf` (trims the command but does not fold it, clips at 28), core `loop-watch.ts` `labelOf` (no trim, `??`, clips at 80), core `fallbackShellName` (clips at 80, feeds a schema), tui `shells.tsx` `named` (a boolean).
- Any pair across tiers that only looks similar (`agent` retry-ledger vs `client` connection-machine).

## Backlog (ranked)

1. Last inline `\s+` folders: tui `ui/components/services.tsx:67` (`snapshot?.command` fold; needs a render spec to pin it first) and wire `upload-name.ts:15` (inside a longer cleaner chain; v1 side).
2. Relative time: mobile `lib/relative-time.ts` and web `settings/data/personal/relative-time.ts` give identical output (only the argument keys differ) → `packages/core`.
3. `parseRepoInput`, identical in web and prototype `new-project-repos.ts`; no package is shared by both apps yet, so it needs a home decision.
4. `initialsOf`: web `settings/session/initials.ts` vs mobile `drawer-content.tsx:64` (first+last vs first two words; `?` vs `''` for empty). Not behaviour-preserving, so it needs a product call.
5. PR state → icon/label/tone tables (5 web copies plus mobile and tui): aria labels and unknown-state handling diverge.
6. `trpcBodyOf` test decoder, 3 identical copies: harness `cloud/__tests__/trpc-body.ts`, serve `__tests__/trpc-body.ts`, tui `composition/__tests__/trpc-body.ts` (all v1 side; `api-router` spec has a fourth inline variant).
7. `repoFullNameOf`: control `repo-name.ts` (case-insensitive, lowercases) vs core `pr-failed-checks-lines.ts:10`.
8. Remaining `clipText` copies outside core/client: tui `classify-report.ts:23`, `crash-report.ts:40`; web `errors/error-report.ts:14` (`truncate`, default limit), `threads/data/preview-ports.ts:12`; `packages/github` `github-check-annotations.ts:31`; core `failed-check.ts:49` (trims first, `undefined` for blank — keep its wrapper).

## Runs

### 2026-11-19

- First run; created this file. Scanned packages/apps helpers and the UI layer.
- Unified `formatTokens` (3 byte-identical copies → client). Pinned with a client spec (moved from tui), a web `tokenStatsOf` m/b case and a tui re-export spec, all mutation-checked.

### 2026-11-20

- No open Dup unifier or abstraction-routine PRs; the only open PR (#2465) touches none of these files.
- Unified `oneLine` (5 identical copies → core `text/one-line.ts`). Pinned with a core spec plus new tui crew failure-line and lost-shells specs; mutation-checked (no newline fold, no trim).
- Added backlog item 2: inline copies that can now call core `oneLine`.
- CI: 4 tui specs red on clean main, unseen by incremental CI: `app-project-resolution` (2) and `live-pod` missed #2423 body decoding; `pr-event-entry` missed #2408 wording. Fixed here.

### 2026-11-23

- Open PRs #2667, #2658, #2620 touch none of these files.
- Unified `clip` (6 identical core/client copies → core `text/clip-text.ts`, `clipText({ text, limit })`). Truth table: same output for every length; only the limits differ, and those stay at call sites.
- Pinned with a core `clipText` spec plus boundary specs in classifier `verdict` (300), `adjudicate` (400), client `pr-event-line` (120) and `loop-watch` (300). Mutation-checked 9 ways, all restored byte for byte.
- Added backlog item 9: the remaining copies in tui, web and `packages/github`.

### 2026-11-24

- Open PRs #2801, #2800, #2789, #2749 touch none of these files.
- Backlog item 1: 8 inline `\s+` folders (6 core, 1 web, 1 tui) now call core `oneLine`. Same expression, so the truth table is identical for every input.
- Pinned with new core `shells/label` and web `processes-model` specs. Mutation-checked `oneLine` 2 ways (spaces-only fold, no trim): every caller's spec fails at least once; restored byte for byte.
- Found 6 more inline copies and the shell-name fallback family; added as backlog item 1.

### 2026-11-25

- Open PRs #2918, #2917, #2914, #2913, #2872 touch none of these files. Web `threads/data/rewind.ts` no longer exists.
- Backlog item 1: 7 inline `\s+` folders (control, client, quality, api, 3 tui) now call core `oneLine`. `trim()` before the fold (transcript-peek) gives the same output; each `slice` stays where it was.
- Pinned with new specs: client shell label trim, tui `serviceNameLabel`, api grep stderr complaint. Mutation-checked `oneLine` 2 ways (no trim, spaces-only fold): every caller spec fails at least once; restored byte for byte.

### 2026-11-26

- Open PRs #3004, #3001, #2968 touch none of these files. Web `processNameOf`/`processLabel` no longer exist.
- Backlog item 1: 6 copies of "trimmed description, else command" → core `shellName` (plain, 3 copies) and `quotedShellName` (quoted, 3 copies). `x?.trim() || y` and `x?.trim() ?? ''` + `=== ''` give the same output for every input.
- Pinned first with a client spec over all 6 quoted-name lines × 4 name shapes, a tui render case (whitespace description, multi-line command) and a tui `buildServiceRows` name case; then a core table spec.
- Mutation-checked 4 ways (no fold, untrimmed quote, unquoted fallback, blank counts as named): every caller spec fails at least once; restored byte for byte.
- Ruled out 4 lookalikes (web preview-ports, core loop-watch, `fallbackShellName`, tui `named`).
- Full tui run: 4 `composer-render` specs failed once and pass alone; not touched here.

### 2026-11-27

- Open PRs #3071, #2968 touch none of these files.
- Backlog item 2: `contextLabelOf` (web, mobile; same expression) → core `contextWindowLabel`. Mobile `EFFORT_LADDER` / `EFFORT_LABELS` → core `EFFORT_LADDER` / `EFFORT_RUNG_LABEL` (same rungs, order and words; the capitalising fallback stays in mobile). Core, not `@dltech/atlas-ui/ai/model-selector`: that subpath pulls DOM components into React Native.
- Pinned first with web and mobile context-label tables (k rounding, 999 999 → `1000k`, `1.5M`) and mobile effort label, ladder-order and `knownEffortOf` cases; then a core table spec.
- Mutation-checked 5 ways (`>` for `>=`, no M decimal, floor for k, empty mobile label map, swapped xhigh/max): each fails at least one caller spec; restored byte for byte.
