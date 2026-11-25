# Dup unifier record

## Unified

- `formatTokens` (k/m/b): tui `ui/theme.ts` and web `threads/panel/details/details-model.ts` now use `@dltech/atlas-client/crew` (`packages/client/src/crew/readout.ts`).
- `clipText` (`slice(0, limit - 1)…`): core `pr-event-block`, `loop-watch`, classifier `adjudicate`, `verdict`, `from-events` and client `pr-event-line` now use `@dltech/atlas-core` (`packages/core/src/text/clip-text.ts`).
- `oneLine` (`\s+` → space, trim): tui `store/sidebar-text.ts`, `sidebar/crew.tsx`, `lost-children-model.ts`, `lost-shells-model.ts`, `shells-model.ts`, web `details/crew-model.ts`, `data/processes-model.ts` and core `shells/label.ts`, `shells/fallback-shell-name.ts`, `agents/name.ts`, `agents/label.ts`, `naming/session-title.ts`, `classifier/verdict.ts` now use `@dltech/atlas-core` (`packages/core/src/text/one-line.ts`).

## Ruled out (intentional divergence — do not re-investigate)

- `packages/ui/src/ai/context.tsx` `formatTokens` (`1.0M`, no billions): `packages/ui` has no Atlas imports by design, and its output differs. Folding it in is a product change, not a dedupe.
- Relative time: web `settings/data/shared/relative-time.ts` (7-day weeks, years, `—` for invalid input) and prototype `new-project-repos.ts` (no week tier) differ on ages callers actually hit.
- `clip` variants `core/compaction/render-range.ts` (keeps `limit` chars), `core/web/render.ts` (trimEnd) and `client/transcript/tools/reading.ts` (code-point safe) do different jobs.
- `oneLine` in `core/memory/index-render.ts` (newlines only, no trim) does a different job from the `\s+` collapsers.
- Byte formatters (tui `transfer-meter`, tui `push-text`, web `skill-format`, ui `queued-message-ops`): units, divisors and rounding all differ, so no single copy preserves every caller's output.
- Agent status labels (web `crew-panel`, client `readout` `STATE_LABEL`, client `tools/agents` `STOP_NOTE`): different vocabularies on purpose.
- Any pair across the v1/v2 line (`agent` vs `agent-v1` retry-ledger, `harness` cloud-retry vs `client` connection-machine).

## Backlog (ranked)

1. Remaining inline `replace(/\s+/g, ' ').trim()` that can call core `oneLine`: client `session/session-rewind.ts:61`, web `threads/data/rewind.ts:50`, control `session-summary.ts:9`, tui `ui/services-model.ts:173`, `ui/components/services.tsx:67`, `packages/quality` `typescript-parser.ts:74`. Then the "description, else folded command" shell-name fallback (core `shellLabel`, web `processNameOf`, tui `shellNameLabel`, client `shellLabelOf`, web `processLabel`): check `?? ''` vs `||` and the id fallback first.
2. `contextLabelOf` (200k / 1M), byte-equivalent in web `threads/data/model-options.ts:67` and mobile `composer/model-options.ts:52`. Mobile `EFFORT_LADDER`/`EFFORT_LABELS` re-declare what `@dltech/atlas-ui` already exports.
3. Relative time: mobile `lib/relative-time.ts` and web `settings/data/personal/relative-time.ts` give identical output (only the argument keys differ) → `packages/core`.
4. `parseRepoInput`, identical in web and prototype `new-project-repos.ts`; no package is shared by both apps yet, so it needs a home decision.
5. `initialsOf`: web `settings/session/initials.ts` vs mobile `drawer-content.tsx:64` (first+last vs first two words; `?` vs `''` for empty). Not behaviour-preserving, so it needs a product call.
6. PR state → icon/label/tone tables (5 web copies plus mobile and tui): aria labels and unknown-state handling diverge.
7. `trpcBodyOf` test decoder, 3 identical copies: harness `cloud/__tests__/trpc-body.ts`, serve `__tests__/trpc-body.ts`, tui `composition/__tests__/trpc-body.ts` (all v1 side; `api-router` spec has a fourth inline variant).
8. `repoFullNameOf`: control `repo-name.ts` (case-insensitive, lowercases) vs core `pr-failed-checks-lines.ts:10`.
9. Remaining `clipText` copies outside core/client: tui `classify-report.ts:23`, `crash-report.ts:40`; web `errors/error-report.ts:14` (`truncate`, default limit), `threads/data/preview-ports.ts:12`; `packages/github` `github-check-annotations.ts:31`; core `failed-check.ts:49` (trims first, `undefined` for blank — keep its wrapper).

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
