# Locked product choices

- Advisory post-write coaching is the default: writes remain committed; no default denial, rollback or automatic repair loop. Dennis explicitly corrected enforcement framing.
- Policies are registered, independently maintained, narrowly scoped modules in the shared harness design; no ad hoc per-tool prompts.
- Settings expose policy controls, not prompt editors. Jev decision evaluation does not imply approval of a second prose-generating model.
- Review must distinguish whole-scope condition from the impact of the edit, and avoid repeated nudges for one unresolved finding.
- Evaluation infrastructure is shared across Atlas AI features, not owned by Code Quality. Policies use deterministic expected-versus-actual grading.
- Dataset preparation uses real Atlas edits and generated, double-checked expected outputs; the development agent iterates questions/context and reruns comparisons.
- Eval results are primarily consumed by coding agents: compact actionable summaries and complete artifacts, no required human dashboard.
- Evaluation failures, model quality and measured latency are separate dimensions; eval workflow instructions belong beside shared evals, not in root instructions.
- This task is to write the implementation spec and parallel workstream plan, not to implement or ship the feature.

# Proposed implementation defaults (not previously chosen by Dennis)

- Initial source coverage: direct built-in write/edit/multi_edit for complete named TS/JS class/function scopes. Shell/background/services/MCP/external changes and other languages are not covered; report this visibly.
- Exact capture is transient ToolOutcome metadata under existing write locks; optional invocation flag keeps OFF behavior unchanged. Process-local locks are not OS-wide transactions.
- Parser: harness-owned TypeScript compiler adapter, dependency pinned to existing root 6.0.3; no TUI/OpenTUI import, no regex confidence fallback.
- Core defines policy/registry/request/interpretation/event/lifecycle/health contracts; main owns shared files. Four peers own capture, review+SRP, shared evals and surface workstreams.
- One tracked open issue episode per policy+scope initially. Evidence changes enrich assessments but do not reset notification; uncertainty/fault never resolves debt. This intentionally favors avoiding recursive nudges over distinguishing every concurrent same-policy issue inside one class. Lifecycle transitions are policy-owned: assessments carry a transition field (None/Introduce/TrackDebt/Resolve) set by the policy's interpret; the shared ledger applies it without policy thresholds. Resolution uses hysteresis (concern<=0.2 + confident Resolved/Improved/Unchanged) so external fixes resolve and genuine reintroductions re-nudge.
- Workspace identity is engine-owned via WorkspaceIdentityPort (normalized git remote URL, else local:root-commit-SHA, plus branch + repo-relative worktree path), probed through the thread's execution backend and cached per directory; never derived from event paths or computed by tools.
- Durable compact code-quality-reviewed records survive destructive summary and remain unrendered; new coaching is one finite nudge per call with lifetimeSteps=1. No direct reviewer log appends or mutable ledger authority.
- Runtime quality model initially pinned to jev-1.13.0; other existing DecisionPort callers retain current default behavior. Preserve confidence and resolved model metadata; mismatched/unknown quality model is not a calibrated result.
- Settings: quality.enabled=false until validated, quality.policies.singleResponsibility=true inert under master-off, quality.recordExamples=false explicit opt-in for local immutable corpus capture. No prompt editor/hot policy unload.
- Responsiveness: 1000ms shared async review deadline; source<=1MiB; request size gated at serialized state+longest question<=24KiB and state+all questions<=48KiB with per-policy-request fallback before OversizedRequest; never silently clip. Report skipped coverage; measure synchronous prep and real p50/p95 rather than asserting hard real-time bounds.
- Shared evaluation backend: stable Evalite 0.19.0, Vitest 4.0.1, Vite 6.4.1 in root evals dev workspace; compiled Node-safe production leaf adapters, no default live model call or UI server, no evaluator edge in shipped binaries.
- Eval artifact integrity: invocation work folder lives at gitignored evals/.work/<uuid>/ inside the workspace (required for external module resolution, contains no config file), artifacts go to --output-parent; fresh in-memory runner storage, explicit trial IDs and exact planned coverage. Compact summary plus full artifacts. Runtime/integrity failure exit 2, completed quality regression exit 1, success exit 0. Root overrides are parent-scoped to evalite only (runner/utils 4.0.1), leaving apps/api's Vitest 3.x and Storybook untouched.
- Dispatcher safety: the engine validates its own review records before rendering the nudge; the dispatcher backstop drops all quality drafts and substitutes one valid OperationalError record, never rejecting a committed tool result.
- Nested instructions: evals/ATLAS.md canonical across all instruction families, suite-specific child instructions; no root instruction edits.
- Real-session data is contingent on explicit sanitized exports or prospective opt-in captures. Historic small diffs do not imply whole scopes. Starter target 48 accepted real cases is not a promise or a calibrated score; expand representative coverage before enabling by default.
- Main first lands contract bootstrap on origin/main, then four teammate branches start from fresh origin/main. Shared-file changes/lock updates remain main-coordinated; no inferred feature-branch stack.
- Strict event decode requires next wire protocol stamp (currently 17→18), matched TUI/serve rollout, and compatibility tests; no new quality-specific websocket frame.

# Explicit gates, not hidden assumptions

- Full installed Node Evalite/native/compiled-leaf smoke is not yet proven; fake no-network compatibility must precede live evals.
- TypeScript public parser/diagnostics API and compiled binary loading must be tested by capture/integration slices.
- Real dataset availability, redaction and independent reference verification must be established before efficacy claims.
- No universal quality threshold is preset. Versioned dataset metric gates are declared before candidate comparison; report precision/recall/FPR/uncertainty/repeats and performance separately.
- The final independent spec review must close interface/ownership/validation contradictions before handoff.
