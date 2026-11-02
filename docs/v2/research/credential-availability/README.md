# Credential availability: v1 work to triage for v2

**Status: needs triage.** This is a v1 feature stack that was stopped part-way on 2026-11-02 when v2
started. Nothing here is a v2 decision. It is kept so the problem and the design are not lost.
Triage decides whether v2 adopts this design, rebuilds it the v2 way, or drops parts of it.

## The problem

A session whose provider credential is dead, exhausted or revoked kept retrying for hours. Every
child agent hit the same wall on its own, nothing told the operator why, and there was no way to
pause an account or ask for one controlled re-check. The fix is truthful waiting: classify the
failure once, stop sending requests the account cannot serve, show one "Waiting for model" issue per
account, and give the operator explicit controls.

## What shipped in v1

| Slice | What it does                                                                    | State                                                                                                      |
| ----- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1     | Failure classification and bounded retries                                      | Merged, #1628                                                                                              |
| 2     | Request-time admission gate (per runtime)                                       | Merged, #1633                                                                                              |
| 3     | Durable cross-runtime authority (Postgres barrier, probe lease)                 | Merged, #1638                                                                                              |
| 4A    | Truthful "Waiting for model" state: events, wait state, non-ending child agents | Merged, #1644                                                                                              |
| 4B    | Recheck/pause controls, `Thread.waitingForModel`, web and TUI waiting card      | Built, not merged. Branch `dennis/credential-availability-slice4b` (5 commits on `main` as of `dd805c75c`) |
| 5     | Explicit recovery (continue with another model, operator-chosen)                | Spec only                                                                                                  |
| 6     | Operator-approved fallback                                                      | Spec only                                                                                                  |

Slice 4B passed typecheck and the core, wire, client, ui, db, harness, serve and api suites after
its last rebase. The TUI and web suites and the builds did not finish on the rebased branch.

## Files

| File                                                                                       | What it is                                                                                                                 |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| [original-plan.md](original-plan.md)                                                       | The original plan: goal, constraints, slice order                                                                          |
| [original-decisions.md](original-decisions.md)                                             | The original locked decisions                                                                                              |
| [build-decisions.md](build-decisions.md)                                                   | Decisions taken while building slices 2–4B, including the scale call (keep the coordination core, drop the receipt crypto) |
| [contracts.md](contracts.md)                                                               | Cross-slice contracts: availability keys, revisions, admission, waiting episodes                                           |
| [sections/](sections/)                                                                     | One spec per slice, 01–06. 05 and 06 are the unbuilt work                                                                  |
| [artifacts/credential-availability-design.md](artifacts/credential-availability-design.md) | The design summary                                                                                                         |
| [artifacts/](artifacts/)                                                                   | Roadmap, plan review and integration notes from the original planning                                                      |
| [findings.md](findings.md)                                                                 | Evidence gathered before planning                                                                                          |
| [slice4a-review-followups.md](slice4a-review-followups.md)                                 | Review notes carried from 4A into 4B and 5                                                                                 |

The specs are v1 documents. Their `path:line` anchors point at v1 code from late October 2026 and
will not match v2.

## Questions for triage

1. **Where does the barrier live?** v1 split it between an in-memory runtime authority and a
   Postgres barrier with a probe lease. In v2 the control plane owns durable state (D1), so the
   barrier and lease probably belong there, and the pod asks it before each model step.
2. **Is waiting a view?** v1 projects waiting from `model-waiting` and `model-wait-cleared` events
   and also mirrors it to a `Thread` column for parked pods. In v2 that is likely a fold in `core`
   (slice 4, views) and the mirror column goes away.
3. **Are the controls inbox commands?** Recheck, Pause and Remove manual pause are operator actions;
   v2 routes durable input through the control-plane inbox (D4) and native commands through the
   `commands` package (slice 6).
4. **Which of slices 5 and 6 does v2 want?** Explicit recovery and approved fallback change which
   model a session uses. They were never built.
5. **Does v2 get slice 1 for free?** Failure classification and bounded retries live in the loop,
   which moves to `packages/agent` (v2 slice 2). It probably carries over as is.
6. **Open product call from 4B:** Pause is only offered for an account that already has a waiting
   episode, because the barrier is keyed by account, provider and model. An account-wide pause needs
   an account-scoped key.

Known gaps in what shipped: a Recheck on a cloud or sandbox account while a probe is already running
reports "applied" instead of "probe in progress", and the terminal Recheck chord (`alt+r`) was not
tested through the real key dispatcher.
