# Dup unifier record

## Unified

- `formatTokens` (k/m/b): tui `ui/theme.ts` and web `threads/panel/details/details-model.ts` now use `@dltech/atlas-client/crew` (`packages/client/src/crew/readout.ts`).
- `oneLine` (`\s+` → space, trim): tui `store/sidebar-text.ts`, `sidebar/crew.tsx`, `lost-children-model.ts`, `lost-shells-model.ts` and web `details/crew-model.ts` now use `@dltech/atlas-core` (`packages/core/src/text/one-line.ts`).

## Ruled out (intentional divergence — do not re-investigate)

- `packages/ui/src/ai/context.tsx` `formatTokens` (`1.0M`, no billions): `packages/ui` has no Atlas imports by design, and its output differs. Folding it in is a product change, not a dedupe.
- Relative time: web `settings/data/shared/relative-time.ts` (7-day weeks, years, `—` for invalid input) and prototype `new-project-repos.ts` (no week tier) differ on ages callers actually hit.
- `clip` variants `core/compaction/render-range.ts` (keeps `limit` chars), `core/web/render.ts` (trimEnd) and `client/transcript/tools/reading.ts` (code-point safe) do different jobs.
- `oneLine` in `core/memory/index-render.ts` (newlines only, no trim) does a different job from the `\s+` collapsers.
- Byte formatters (tui `transfer-meter`, tui `push-text`, web `skill-format`, ui `queued-message-ops`): units, divisors and rounding all differ, so no single copy preserves every caller's output.
- Agent status labels (web `crew-panel`, client `readout` `STATE_LABEL`, client `tools/agents` `STOP_NOTE`): different vocabularies on purpose.
- Any pair across the v1/v2 line (`agent` vs `agent-v1` retry-ledger, `harness` cloud-retry vs `client` connection-machine).

## Backlog (ranked)

1. `clip` (`slice(0, limit - 1)…`), 3 identical copies: core `assembly/rules/pr-event-block.ts:16`, `events/loop-watch.ts:20`, client `transcript/pr-event-line.ts:16` → `packages/core`.
2. Inline `replace(/\s+/g, ' ').trim()` that can now call core `oneLine`: core `shells/label.ts`, `shells/fallback-shell-name.ts`, `agents/name.ts`, `agents/label.ts`, `policy/classifier/verdict.ts`; web `data/processes-model.ts:49`; tui `shells-model.ts:109`. Skip v1 harness.
3. `contextLabelOf` (200k / 1M), byte-equivalent in web `threads/data/model-options.ts:67` and mobile `composer/model-options.ts:52`. Mobile `EFFORT_LADDER`/`EFFORT_LABELS` re-declare what `@dltech/atlas-ui` already exports.
4. Relative time: mobile `lib/relative-time.ts` and web `settings/data/personal/relative-time.ts` give identical output (only the argument keys differ) → `packages/core`.
5. `parseRepoInput`, identical in web and prototype `new-project-repos.ts`; no package is shared by both apps yet, so it needs a home decision.
6. `initialsOf`: web `settings/session/initials.ts` vs mobile `drawer-content.tsx:64` (first+last vs first two words; `?` vs `''` for empty). Not behaviour-preserving, so it needs a product call.
7. PR state → icon/label/tone tables (5 web copies plus mobile and tui): aria labels and unknown-state handling diverge.
8. `trpcBodyOf` test decoder, 3 identical copies: harness `cloud/__tests__/trpc-body.ts`, serve `__tests__/trpc-body.ts`, tui `composition/__tests__/trpc-body.ts` (all v1 side; `api-router` spec has a fourth inline variant).
9. `repoFullNameOf`: control `repo-name.ts` (case-insensitive, lowercases) vs core `pr-failed-checks-lines.ts:10`.

## Runs

### 2026-11-19

- First run; created this file. Scanned packages/apps helpers and the UI layer.
- Unified `formatTokens` (3 byte-identical copies → client). Pinned with a client spec (moved from tui), a web `tokenStatsOf` m/b case and a tui re-export spec, all mutation-checked.

### 2026-11-20

- No open Dup unifier or abstraction-routine PRs; the only open PR (#2465) touches none of these files.
- Unified `oneLine` (5 identical copies → core `text/one-line.ts`). Pinned with a core spec plus new tui crew failure-line and lost-shells specs; mutation-checked (no newline fold, no trim).
- Added backlog item 2: inline copies that can now call core `oneLine`.
- CI: two `app-project-resolution` specs were red on clean main (fixture missed #2423's tRPC body decoding); fixed in the same PR.
