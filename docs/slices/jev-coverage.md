# Jev coverage — S1b: oversized scopes

### 5.3 S1b — oversized scopes

Measured 2026-11-25 against production. The 28 h window holds **200** `oversized_request` skips
(5.4% of 3,697 reviews) and 0 `oversized_source`. Every one is a single-policy (SRP) request: 148
class scopes, 52 function scopes. The scope's line span is p50 509, p90 1,540, max 1,855.

30 of the 200 were rebuilt exactly and checked against the record's before and after hashes. Their
request state is 20.4–92.3 KB (p50 28.5 KB, p90 54.5 KB), with before p50 8.1 KB and after p50
8.6 KB. **All 30 fail the 24 KB bound** (`state + longest question`), and 5 also fail the 48 KB
bound. With one policy the 24 KB bound is the binding one. Jev itself allows 64k tokens per request
and 32k per question (`classifier.md` §4.2), and production latency is p95 330 ms against a 1,000 ms
budget. The bound is neither the provider's limit nor the deadline.

**Decision: review an oversized scope as an excerpt** (option b), and keep the bound as the hard
stop. Raising the bound (option a) covers only 27 of the 30 rebuilt cases: the population's p90 span
projects to about 170 KB, or 42k tokens of state, over Jev's 32k per-question limit. Splitting the
class (option c) changes the SRP question.

The excerpt carries the changed lines with 25 lines of context, capped at 90 lines per side with an
omission marker; the class's member outline as `kind name lines a-b`, capped at 60 entries; and the
changed evidence entries, capped at 32. The state flags it as `scope.excerpt` with the context size,
the start line and the omitted line counts, so the labelling loop can measure that stratum on its own.

Offline after count: 30 of 30 rebuilt cases now fit the bound (0 skipped, against 30 of 30 before).
No scope that fits today changes: the planner returns its request byte-identical, and a spec pins
that. A pathological 900 KB change is still skipped as `oversized_request`.
