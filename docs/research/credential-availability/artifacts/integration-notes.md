# Plan integration notes

Current phase: specs authored; contracts under reconciliation and independent review. No source changes or implementation tests.

## Main review changes sent to planners

1. Preserve bounded existing helper/utility→eligible session fallback in foundation slices; deleting all fallback before replacement recovery UI is a regression. Gate each candidate; never hide malformed/delivery/cancelled faults; no new main auto alternate before06.
2. Probe first-output success is non-terminal: a stream can fail later. The exact shared contract must distinguish probe→ordinary promotion from final settlement; idempotence must not drop later SSE quota/failure. No successful stream abortion just to expire a probe.
3. Do not invent provider error.reset_at/resets_at fields. Use already parsed or verified provider metadata only; otherwise reset unknown.
4. Family-only explicit recovery is sufficient first release. Account-wide bulk and make-default mutation are deferred, no placeholder UI. Keeps operator choice and stored defaults independent.
5. Actual route/credential/usage accounting correctness is required by explicit recovery05, not solely optional fallback06.06 must reuse that foundation.
6. Section03 currently too large for a single reviewable PR (gate+receipts+OAuth canonical linking/cache/reauthorization). Authority planner asked to split useful API-key Cloud enforcement03a from OAuth integration03b, same port/state machine, independent acceptance gates; no giant all-or-nothing credential rewrite.

## Review owners

- Foundation planner revising01–02.
- Authority planner finalizing03 and potential03b split.
- Experience planner revising04–06.
- Independent reviewer auditing all section files for remaining concrete blockers.

## Not claimed

- Inference saved key invalid (unproven).
- Tests/build/preview green for this feature (not run: planning only).
- Bulk recovery/default changes or new automatic fallback approved for implementation (not yet).
- Persisted manual pause instantaneous revocation of already admitted or in-flight provider requests.
