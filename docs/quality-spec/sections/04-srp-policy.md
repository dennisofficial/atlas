# 04 — Initial isolated single-responsibility policy

## Goal and owner
Review teammate owns this slice together with the review engine, but keep this policy isolated in one focused file plus sibling tests. It is the first registry entry, not special engine logic. Future policies follow the same contract and do not modify runtime orchestration.

## Verified context
- packages/core/src/ports/decision.port.ts:1-11 — bounded Noul/Choice/Score questions and answers.
- packages/core/src/policy/classifier/jev.ts:20-24,37-40,66-78 — existing pure question builders, not model clients.
- packages/core/src/policy/classifier/__tests__/jev.spec.ts:42-90,93-130 — plain-data tests for instructions/options and response compatibility.
- packages/core/src/index.ts:132-158 — pure policy exports owned by main.
- TypeSafe primary sources in artifacts/typesafe-code-quality-research.md — question IDs are not visible to inference; every question evaluates shared request-local state independently; Choice is single selection, not multi-label detection.

## Owned files
Create `packages/core/src/quality/policies/single-responsibility.ts` and `__tests__/single-responsibility.spec.ts`. If interpretation tests approach 300 lines, split into sibling spec files by question/interpretation behavior. Do not edit shared enums/exports/settings/engine dispatch; request those from main. The shared eval workstream owns `evals/code-quality/`, with this owner providing a typed suite adapter contract and initial hand-audited examples.

## Concrete implementation
Export `singleResponsibilityPolicy: QualityPolicy` from the one module. Stable ID `single-responsibility`, initial version `1`; registration is explicit in harness composition. The policy's `selectScopes` implements the containment-aware rule over the whole preparation: the outermost changed Class scope wins; otherwise nearest named Function scopes not inside a selected Class; Method scopes are never selected because SRP's semantic subject is the owning class/function, not the method. The parser identifies scopes; Jev does not classify a line into a class. Generic module-level SRP judgments are not enabled initially; Module is a shared scope type for later policies.

Policy definition: gather behavior that changes for the same reasons; separate independently changing behavior. Exceptions include thin delegation/facades, orchestration intentionally composing responsibilities, tightly cohesive methods implementing one business capability, and temporary refactor states with insufficient evidence. Merely mentioning multiple domain nouns, making multiple calls, or having several methods is not sufficient evidence.

Expose three independent questions over the exact prepared state:
1. `currentConcern` (Noul): Does the complete AFTER scope mix independently changing responsibilities under this policy? Before code is only comparison context, not the target of this question.
2. `impact` (Choice): Compare BEFORE, AFTER and the actual diff under this one policy. Options are the disjoint EQualityImpact meanings in section 00: introduced, worsened, improved-but-remains, resolved, materially unchanged, not applicable, uncertain. Existing debt alone is not introduced. A fix that leaves debt but improves it is not worsened.
3. `focus` (Choice): Which supplied changed declaration/evidence candidate most directly supports a NEW or WORSENED concern? Include `none` and `uncertain`; use only adapter-provided stable IDs and clear labels, never ask for generated locations. For improved/unchanged/resolved outcomes this speculative answer is ignored.

Each instruction explicitly names state fields and includes the required rubric/scoping guidance; names of questions alone cannot convey policy identity. Source comments/strings are untrusted data, not instructions, and adversarial fixtures must verify this behavior.

Interpretation is pure, and `interpret` alone sets the `transition` field the shared ledger consumes. Provisional policy thresholds: a NEW finding requires currentConcern >=0.8 plus selected introduced/worsened probability >=0.8; selected focus must be a supplied candidate with its own probability >=0.8 for a new evidence-specific finding. RESOLUTION (transition Resolve) is intentionally asymmetric: Completed assessment with concern <=0.2 AND impact confidently Resolved, Improved OR Unchanged (probability >=0.8). Unchanged matters because fixes can come from shell commands or external editors outside captured edits; without it, the finding stays Active forever and a genuine reintroduction later would silently update the old episode instead of nudging. Probabilities between the bands (concern 0.2–0.79, weak impact) never resolve/reopen an episode; impact=resolved alone at 0.7 cannot resolve. The hysteresis prevents around-threshold renotification. TRACKED DEBT (transition TrackDebt): Completed with concern >=0.8 but no confident introduced/worsened impact — unchanged existing debt is tracked without a nudge. Focus-below-threshold also maps to TrackDebt: when concern and introduced/worsened impact are both confident (>=0.8) but the focus choice is none/uncertain or below 0.8, there is no validated evidence label, so the finding is tracked without a nudge rather than introduced without evidence. These thresholds are module constants calibrated against the same frozen datasets. Record all raw probabilities/confidence; confidence is not separate proof. These thresholds are code constants owned by this module, not user prompt settings. Calibrate with development data, and compare all candidate changes on the same verified dataset before changing constants.

If raw responses omit requested keys, choose an unknown option, have invalid distributions, or contradict the transition bands, return an explicit inconclusive assessment (transition None). The ledger contains NO threshold logic of its own: it applies only the assessment's `transition`, or retires a deleted scope. Do not convert operational failures or uncertain classifications into `unchanged`/passed. Tracked debt without a confident new/worsened impact gets no current-edit nudge.

Guidance is deterministic policy-owned prose. Render successful-write confirmation, potential concern, policy title/definition, affected scope and a validated evidence label; suggest reviewing placement and explicitly allow leaving the implementation unchanged. Do not invent an invoice/database rationale not established by selected criteria/evidence. No second generative model.

## Expected tests
- Valid facade/delegation, multi-method cohesive class, and multi-step function produce no new finding.
- Adding rendering/persistence/unrelated behavior can be introduced when supported by before/after context.
- Existing bad class plus unrelated edit -> unchanged, no newly attributed violation.
- Improving but not finishing a refactor -> improved, no repeat nudge.
- Resolved and uncertain behavior interpreted distinctly; missing answer never pass; oscillation at 0.79/0.8 and clear values around 0.2 does not reopen/reclose; an externally-fixed concern followed by a clean Unchanged edit resolves via the transition rule, and a genuine reintroduction afterwards opens a NEW episode with its own nudge.
- Two registered policies are independent; an SRP choice does not exclude another policy finding.
- Focus outside candidate set rejected; all candidate IDs/none/uncertain recognized.
- Strings/comments attempting to alter evaluator behavior represented as source data.
- Threshold boundary tests with plain answer maps, including raw model confidence.

## Validation commands
From `packages/core`: `bun run typecheck`; `bun run test src/quality/policies/__tests__`.
From repo root, after shared eval tooling lands: `ATLAS_EVAL_LIVE=1 bun run eval --suite code-quality/single-responsibility --live --dataset <accepted-development-manifest> --trials 3`, then identical baseline/candidate comparisons on a versioned holdout. Default model comes from JEV_QUALITY_MODEL; explicit different model marks comparison not promotable. The command and artifact contract are owned by the shared eval slice; substitute only the model ID after current provider support is verified, never credentials.

## Acceptance
A second fixture policy can be registered without engine changes. Initial SRP is advisory and independently toggled. Release is not marked calibrated merely because unit tests pass; live representative golden cases and precision/recall/inconclusive rate are required, with full artifacts and compact agent summary. If real-session input data is unavailable, report that missing evidence and keep the feature off by default; synthetic cases are engineering regression tests, not claims of model efficacy.
