# Live session investigation — 2026-10-31 ~19:30 UTC

Read-only investigation. No sandbox lifecycle actions, production mutations, config changes, commits, or source edits.

## Verified live state

- Evidence automations post-demo handoff: live serve health 200, turnRunning=true, current transcript events include Storybook tests and edits at 19:27 UTC. Real ongoing work.
- Fix stopped local-pod threads on Mac: live turnRunning=false,busy=false,childrenRunning=2,pendingInput=true,settlingWork=true. Parent idle; background family alive.
- Session item sidebar revamp: live turnRunning=false,busy=false,childrenRunning=3,pendingInput=true,settlingWork=true. Parent idle; background family alive.
- Speed up slow thread loading: live turnRunning=true,childrenRunning=1. Teammate has produced PR #1609; recorded failureCause mentions monthly limit, but code preserves old failureCause across successful child runs, so ending metadata cannot establish each restart freshly failed.
- Fix agent stall and model fallback (screenshot): DB working=false, main last persisted event 18:28:07 UTC task list holding release on unresolved TUI timing caveat. Screenshot last final text 17:51:25 UTC. No run-failed event or Turn row in production mirror to establish exact parent interruption. Session logs independently confirm real monthly-spend-limit 429 retries in several child threads, at one-minute intervals up to attempt 5/5. Also repeated invalid inference key and missing OpenRouter auth warnings, falling back to session model. Screenshot is stopped, not currently executing; cannot attribute parent stop definitively to these child errors.

## Code explanation

- packages/harness/src/activity/state.ts:38-45 computes working=turning||background.
- packages/harness/src/activity/binding.ts:31-47 background includes any running agent or shell.
- Failed activity send can be dropped (apps/serve/src/serve-activity-reporter.ts:30-45), but no evidence the live active sessions here are mere stale DB flags.
- Child failureCause/failureKind not cleared in packages/harness/src/agents/registry/child-steps.ts:91-99; stale metadata must not be counted as a fresh failure.

## Evidence

session-health.txt, session-state-names.txt, session-details-summary.txt, runtime-errors.txt, screenshot-thread-logs.txt, screenshot-outcomes.txt.

Recommended: leave truly active work intact; for screenshot resume unfinished validation after checking usable model credentials. Product fix should distinguish working parent/background work/blocked failures and treat spend exhaustion as non-transient rather than minute retries. Any recovery or source change requires next task; not performed during diagnosis.
