# Shared implementation brief: event-sourced shell endings

This is the working brief every teammate reads. The design rationale is in
`docs/research/shell-ending-event-sourcing.md`. Read both before coding.

## The target state

One sentence: **the durable event log is the only announcement channel for a
shell ending, and the ending event is written at occurrence, not at drain.**

- `startBackgroundShell`'s settle continuation appends the `background-shell-ended`
  event (full remaining output + after-shell hook drafts) the moment the shell
  settles. After this, the log is complete at all times.
- `ShellNoticeQueue` becomes a wake-up bell: it signals "new event at seq N for
  thread T" so the turn/UI wakes. It no longer produces the ending draft, no
  longer owns the output cursor, no longer carries hook drafts, no longer reaps.
- `shell_kill` still waits and still returns `snapshot + output`, but the result
  is explicitly a read. The claim machinery (`endingClaimed`, `outputClaimed`,
  the hollow notice) is deleted.
- Teardown's `recordEndings` / `unresolvedEndings` synthesis is deleted: a
  settled shell always has its end in the log. Recovery keeps only the genuine
  "start with no end = died mid-write" case.
- The `recorded: true` flag (PR #922) is deleted — it patched the old shape.
- Model assembly suppresses the redundant `<background-shell-ended>` block when
  the same turn already answered a `shell_kill` for that shell — a presentation
  suppression, never a delivery guarantee. If it misfires the cost is one
  redundant line, never a lost/duplicated record.

## Non-negotiables

- `packages/core` stays pure — no I/O, no clock, no randomness. Occurrence-write
  lives in `packages/harness`.
- No `as any`, no `@ts-ignore`, strict TS, max 300 lines/file, no comments that
  restate code (see CLAUDE.md). Named params for 2+ args, `handle`-prefixed
  handlers, `E`-prefixed enums.
- `bun test` everywhere; specs in sibling `__tests__/`. Scratch `ATLAS_HOME` for
  any spec that boots a registry (the guard refuses the real home).
- Every behavioral change has a regression test mirroring the real incident
  shape (shell_kill returns exit+output, then teardown/resume must not re-tell).

## Hard ordering constraints (from the writer/reader map)

- The output delta is measured by a cursor today. At occurrence, capture the
  full remaining output into the event, then the buffer can release. Reads after
  that hit the released shell (counts only) — that matches the contract.
- After-shell hooks run at occurrence already (in `queueEnding`, off the exit
  continuation). Append `endedDraft + hooked` together there. The `settling` set
  becomes the "append outstanding" set that `closeAll`/`awaitEndings` await.
- A shell removed by rewind while hooks run currently drops the notice. With
  occurrence writes, an append may race rewind's `destroy` — the ending event
  must not be written for a shell whose thread was cut. Coordinate with the
  consumers teammate on rewind-plan/rewind.ts.
- Every current drain caller (`pending-intake.ts`, `tracked-turn.ts` ×3,
  `session-teardown.ts`, `stop-local.ts`) appends what the drain returns. Once
  the event is in the log at occurrence, the drain must stop producing it or the
  log gets two endings per death and `lifecycleOf` mis-pairs. The bell-only
  queue must yield no ending draft.

## Owned-slice boundaries

Teammates touch disjoint files. The seams between slices are the public port
signatures in `packages/harness/src/shells/shell-registry.ts`
(`ShellRegistryPort`) and `notice-queue.ts` — coordinate changes to those
through the orchestrator, not by editing a file another teammate owns.
