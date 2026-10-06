# 03 — Shared, agent-oriented AI evaluations and real-session datasets

## Goal and teammate ownership
Evaluation teammate owns the new root `evals/` workspace. It is shared across all Atlas model-backed features, not a Code Quality runtime package. Deliver generic versioned dataset/feature/scorer contracts, a pinned Evalite backend, trustworthy one-shot artifacts, compact agent output, read-only data curation, and nested workflow instructions. Main owns root/harness manifests, lock and initial eval workspace skeleton; this teammate owns evals/package.json after bootstrap and supplies coordinated root/script/dependency requests.

## Evidence and exact baseline
- package.json:5-9,14-30 — existing Bun workspaces packages/apps; explicitly add `evals`.
- turbo.json:3-17 — topological tests/typecheck/build; no cached live-model task.
- packages/core/package.json:6-17 and harness/package.json:6-38 — raw TS exports; core remains zod-only, harness remains production Bun/AI SDK 7.
- packages/core/src/ports/decision.port.ts:13-22 and harness/src/classifier/jev-client.ts:10,47-80 — exact production decision seam, timeout, zero retries, failure-as-data; convert faults to execution errors in evals.
- packages/harness/src/index.ts:3-35 — broad production barrel must NOT be imported by Node eval adapter.
- packages/core/src/events/body.ts:92-106; harness/store/sessions/lines.ts:43-54,90-112; paths.ts:52-79 — event envelopes, inputs/outputs, thread data paths.
- tools/builtin/write.ts:67-75 — historical overwrite has no before content; edit.ts:93-118 and multi-edit.ts:84-109 give only normalized limited-context diffs; unified-diff.ts:3,119-147 uses three context lines.
- tools/builtin/read.ts:25-29,83-90,254-282 — historical reads can be clipped and normalized; not universally exact byte baselines.
- packages/core/src/ports/workspace.port.ts:1-3 and dispatch.ts:222-243 vs docs/architecture.md:180-182,1015-1021 — documentation's per-tool snapshots are stale; current mechanism does not provide historic full source baselines. Main updates only misleading structural paragraphs; do not reintroduce restoring rewind.
- packages/core/src/context/instruction-files.ts:26-46,96-113 — ATLAS.md is universal; AGENTS.md is family-dependent. Canonical nested instructions will be evals/ATLAS.md.

Primary-source/toolchain evidence is in evidence/eval-seams.md:59-88, including published stable package source and zero-network Node leaf probe. Pin `evalite 0.19.0`, `vitest 4.0.1`, `vite 6.4.1` exactly initially. Evalite depends on `@vitest/runner ^4.0.0` and `@vitest/utils ^4.0.1` while direct Vitest 4.0.1 pins its own copies exactly; apps/api uses Vitest 3.x and Storybook has 3.2.4 utils. To unify Evalite with direct Vitest WITHOUT forcing api/Storybook onto runner 4, main adds a PARENT-SCOPED root override: `"overrides": { "evalite": { "@vitest/runner": "4.0.1", "@vitest/utils": "4.0.1" } }` (Bun root-only overrides support one parent level; Bun overrides docs). First gate verifies: exactly one 4.0.1 runner/utils under evalite, apps/api still resolves Vitest 3.x and its vitest suite stays green, Storybook resolves its own utils, and native better-sqlite3 install/trust behavior is inspected. Stable differs from beta; do not mix APIs. Node 22.13.x executes eval children, Bun installs/builds and runs engineering tests. Exact installed toolchain/native import parity remains an explicit first gate, not a proven property of the planning probe. Eval workspace dependencies+lockfile are REQUIRED bootstrap deliverables; if not verified, main does not start slice 03.

## Owned new files and dependency scope
- evals/package.json, tsconfig.json, ATLAS.md, evals/.gitignore (containing `.work/`). No evalite.config.ts: the supervised child controls every option programmatically and the run workdir provably contains no config file (config loading is an interactive/local convenience only, never the agent path).
- evals/src/{case,manifest,feature,feature-registry,grading,metrics,results,integrity,summary,cli,worker}.ts and sibling __tests__.
- evals/src/curation/{inventory,reconstruct,redact,candidates,label-review,splits}.ts and sibling tests; split further only to stay <=300 lines.
- evals/code-quality/{feature,task,grading,entry.eval}.ts and dataset schemas.
- evals/datasets/code-quality/single-responsibility/{manifest,cases}.json/jsonl only for reviewed/public-safe accepted examples; private corpus supplied by explicit path outside repository.
- Synthetic/fake fixtures clearly separate under evals/__fixtures__/; do not masquerade as real session examples.

Root/main adds explicit evals workspace. All evalite/vitest/vite/zod/core/harness/types dependencies belong to this development-only workspace, never core/harness runtime. Harness adds TypeScript parser dependency separately under source slice. Do not add LangChain/openevals/AI SDK tracing wrappers or a new model client. Evalite owns scheduling/result storage; Atlas owns feature adapters, integrity and concise report formatting, not a replacement evaluation runner.

## Generic feature and dataset contract
New pure/dev `EvalCase` envelope: `{schemaVersion:1,id,featureId,input,expected,tags,provenance,review}`. JSON data on disk; `input` and `expected` are unknown until feature-owned Zod schemas validate them. Provenance contains source group/method/hash/version and completeness; review contains Accepted/Provisional/Quarantined state and independent verification records. Primary eval accepts ONLY accepted cases. Expected labels can be generated during preparation, never silently regenerated for each competing prompt.

Manifest: `{schemaVersion,featureId,inputSchemaVersion,expectedSchemaVersion,rubricVersion,datasetVersion,casesFile,contentHash,split,caseIds,counts,metricGates}`. Validate duplicate IDs, exact case count, hash/version, supported split and required scorer applicability. Preserve reasons for rejected/partial examples.

`EvalFeature<TInput,TExpected,TOutput>` defines stable ID/versions, three Zod schemas, async `run({input,context})`, deterministic evaluator list and optional dataset-level reducer. Each evaluator has stable ID, an explicit applies({input,expected}) predicate, and grade({input,expected,actual}) -> finite [0,1] score plus bounded difference metadata. Context carries invocation/trial/variant/model/deadline but NEVER expected. Model-facing production request sees only input, not case IDs/labels/rationale. Optional AI graders may be registered by other future features; SRP uses deterministic comparisons.

Register features explicitly at build/startup. Do not create a dynamic arbitrary plugin loader. A generic calculator-style synthetic fixture must prove that shared infra is not shaped around SRP. Eight correct exact comparisons out of ten completed quality cases yields 0.8, independently per evaluator.

SRP actual output compares normalized impact/current-concern/evidence IDs, not generated prose, durations or episode UUIDs. Grade each required field separately and expose exact tuple accuracy. State/shape/request faults are execution/interpretation diagnostics; ambiguous expected cases grade correct abstention explicitly. Dataset-level confusion counts and ratios are computed from validated rows, not averaged arbitrary scorer means.

## Node execution and production-code reuse
Prefer a direct Node adapter, not a Bun worker bridge. Code Quality task imports main's pure `prepareQualityRequest`/`interpretQualityResponse`, the isolated source preparation leaf when replaying captured file input, and **the JevDecisionClient leaf file**, not @dltech/atlas-harness barrel/container/stores. No second copy of prompts.

Make task imports deterministic through a pre-run Node-target build:
- Build TypeScript supervisor/worker to evals/dist with `bun build --target=node` and external evalite/vitest packages.
- Build the selected feature/task adapter with `bun build --target=node` into a gitignored work folder `evals/.work/<uuid>/` INSIDE the workspace, bundling its pure core/Jev/source-parser dependencies as in the successful planning leaf probe. The compiled entry imports `evalite`/`vitest` as externals resolved from the workspace's node_modules; placing the work folder anywhere else (e.g. under --output-parent outside the repo) makes those imports fail with ERR_MODULE_NOT_FOUND, so this location is load-bearing. The work folder contains no evalite.config.*; artifacts/results are written to --output-parent, not into the work folder. Record adapter/code digest; rebuild for every prompt/policy version. Do not bundle the harness barrel. Work folders accumulate (runs are never deleted) and are gitignored via evals/.gitignore; the summary notes cleanup. Add "the compiled entry imports evalite from the work folder" to the first installed-runner gate.
- Evalite entry registers data/task/scorers from that compiled feature descriptor with explicit invocation manifest. If future feature actually needs Bun, expose a separate justified subprocess adapter later, not preemptively.

No-internet/fake transport uses JevDecisionClient's existing systemOne injection, exercising real request preparation and interpretation. Fake outputs are declared fixture transport answers, not expected values passed to a real model. Artifacts say mode=fake and cannot be reported as live efficacy. Live mode must be explicit (`--live` plus ATLAS_EVAL_LIVE=1), uses supplied runtime config, and must not load the app container or real user home. Missing endpoint/model configuration is a config error, not an implicit fallback.

Compatibility gate: installed Node Evalite must load compiled real Jev leaf, current pure policy modules and TS/JS source adapter, execute synthetic transport, emit exact planned rows, export new JSON and exit. The prior leaf bundle probe does not prove native SQLite or the full runner. If gate fails, fix narrow bundling/dependency configuration; do not quietly fork a second runner or force-cast an AI SDK v4 model into Evalite's v2 tracing adapter.

## One-shot artifact protocol and agent report
Evalite stable can exit the process and export latest-full rather than this invocation. Use a supervised Node child, not runEvalite in the parent process. Child imports `runEvalite` from evalite/runner and `createInMemoryStorage` from evalite/in-memory-storage (published d.ts verified). Supervisor always passes `cwd` as the NEW exclusive invocation workdir `evals/.work/<uuid>/` inside the workspace (required for external module resolution), separate from the artifact output in --output-parent. That workdir contains no evalite.config.*, proving config cannot silently load env/setup behavior or override controlled run options. Invoke with `mode:'run-once-and-exit', disableServer:true, hideTable:true, storage:createInMemoryStorage(), outputPath:<run>/evalite.raw.json, testOutputWritable:<log stream>`. Export's own console messages are also redirected by parent process capture. Record explicit controlled settings in the manifest.

1. Parent creates a new exclusive UUID run directory under explicit --output-parent (default session evidence directory when Atlas runs it). Never reuse/delete an earlier run. Write invocation manifest BEFORE child: code/adapter/questions/grader/model requested versions, dataset hash, enabledPolicyIds, batchMode (batched vs per-policy-split), exact planned case/trial/variant IDs, concurrency/deadlines, mode and start timestamp. The request a policy sees depends on the enabled policy set and batching mode (section 00), so both live here — never in the dataset manifest. 'Production configuration' is defined as the default registered+enabled policy set at bootstrap; baseline and candidate runs must match it, or the comparison is recorded as not promotable. No secret values in arguments/manifests.
2. Expand repeats into explicit inputs with caseId/trialId/variantId; set Evalite native trialCount=1 because stable JSON drops stored trialIndex. Separate unique case count from number of trials. Disable caching when measuring repeat stability/performance.
3. Child uses fresh in-memory storage so missing/empty/all-skipped imports cannot export previous runs. Capture complete stdout/stderr/task diagnostics to files, not terminal/context. Child status always retained; no swallowed nonzero exit.
4. Parent validates new artifact existence, schema/freshness, planned exact cardinality, unique row identities, completion statuses, output schemas, required finite scores and evaluator coverage. Missing/extra/duplicate/skipped/unassociated rows, .only filtering, stale/partial/truncated output, invalid NaN scores or failed imports are integrity errors. A raw 'full run' or high average is not proof.
5. Normalize results.jsonl with actual/expected comparisons, status/error, case/trial/variant, raw-answer reference and timing breakdown. Write summary.json and short summary.txt atomically; mark COMPLETE only after validation. If child crashes, retain diagnostics and publish failed/incomplete summary, never reuse results.
6. Exit 0 for complete configured quality success, 1 for complete quality regression, 2 for config/provider/runtime/integrity failure. Distinguish process failure from deterministic grade zero. Reports may show successful-decision-only efficacy for partial runs, but cannot promote it as a complete dataset score.
7. Terminal: status, unique cases/trials/errors/inconclusive count, per-metric changes vs baseline, a few failure IDs expected->actual, total failure count and full artifact path. Do not print complete source, traces or every passing case. Full evidence stays on disk; agents request targeted failures by ID. No watch server/dashboard is necessary.

This is a small reporter/integrity layer around Evalite, not another framework. Normal default test/build/typecheck never initiates model calls.

## Real-session input acquisition and expected-label verification
Prospective examples are not directly curation input. Add explicit read-only `eval:export-examples --session-dir <named-session-directory> [--session-dir ...] --output-dir <new-directory>` — input is RAW named session folders chosen by the operator (never an ATLAS_HOME scan); the exporter is what sanitizes. It enumerates only those sessions' `threads/*/quality/examples/**`, verifies original recorded digests/schemas, applies the allowlisted deterministic redaction and records the redaction map, re-runs the source adapter on redacted text to confirm scopes still parse, and stores NEW redacted-text digests alongside original hashes. It writes a new export plus manifest/rejection ledger and refuses an existing output directory. Never reads other session files by default. Curator is read-only and requires an EXPLICIT sanitized export directory. It never recursively opens ATLAS_HOME, accounts, raw tapes, .env files or all sessions by default. Parse copied versioned event files and source evidence, not mutating live session registries/migrations.

Accept:
- New opt-in captured scope examples from section 02 (preferred; exact source/provenance).
- Historical successful edits only where a provided full baseline plus matching patch/reconstruction proves complete before/after semantic scope. Record normalization and observational limits.
Reject/quarantine missing originals, diff-only class context, ambiguous before-hook input rewriting, missing settlements, forks duplicated by inheritance, interrupted/pruned/rewound gaps and external/shell mutation uncertainty. Never substitute today's disk or an assumed Git HEAD for the old source. No per-edit snapshot promise.

Pipeline: inventory -> pair owned thread/run/call occurrences -> reconstruct/apply/verify hashes -> deterministic redaction plus independent content review -> dedupe/group -> candidates.jsonl -> expected-output draft generation -> independent blind verification -> accepted cases+manifest and rejected/quarantine ledger.

Expected generation is an offline agent procedure, not an extra production judge: development agent proposes expected categorical fields under a versioned policy rubric; a separate reviewer sees input/rubric WITHOUT candidate Jev output and confirms/corrects/marks ambiguous. Persist generator/verifier model or agent identity/version and adjudication. The label-review tool ingests these draft/verification files and refuses unverified cases. Changing verified expected output creates a new dataset version and reruns BOTH baseline/candidate. No runtime automatic label regeneration inside scored task.

Group splits by session/repository/change family; near-duplicates, successive edits and forks stay together. Development cases support prompt tuning; holdout is for promotion, not each tuning turn. Synthetic/metamorphic/adversarial probes remain labelled separately and are not counted as real-session volume.

Initial curation target, not invented acceptance: 48 accepted real edits (about 32 development/16 grouped holdout) plus 8-12 separately labelled probes, contingent on authorized exports. Inventory real availability first. Expand toward >=200 unique representative cases for durable calibration; fewer trustworthy pairs are preferable to padded guessed labels. No calibration claim or default enablement while adequate real examples are unavailable.

## Shared nested instructions
Create `evals/ATLAS.md` as the canonical workflow instructions, with code-quality-specific `evals/code-quality/ATLAS.md` for policy rubric/data details. Do not edit root instructions or duplicate drifting AGENTS prose. Instructions cover exact commands, explicit live mode, manifest/label versions, dataset verification, grouped splits, baseline comparisons, quality/error/performance separation, compact artifacts and targeted failure inspection. Agents must explicitly read these files before a bash-only root eval command, because nested loading depends on touched paths/cwd.

## Commands after implementation
Main adds root script `eval` forwarding to evals eval:run (not Turbo-cached live task). Eval workspace scripts: build (Node-target CLI/worker), typecheck, test (Bun synthetic/fake engineering tests), eval:run, eval:validate, eval:export-examples, eval:curate, eval:label-review, eval:compare. All arguments parsed strictly; output is session evidence by explicit path.

- `bun run --cwd evals typecheck`
- `bun run --cwd evals test`
- `bun run eval --suite smoke --fake --trials 2 --output-parent "$ATLAS_CONTEXT_DIR/evidence/eval-smoke"` (model defaults to exported JEV_QUALITY_MODEL; explicit override marks run not promotable)
- `bun run --cwd evals eval:validate --manifest <accepted-manifest>`
- `bun run --cwd evals eval:export-examples --session-dir <named-session-directory> [--session-dir <second>] --output-dir <new-export-directory>`
- `bun run --cwd evals eval:curate --export-dir <sanitized-export> --output-dir <new-private-candidates-directory>`
- `bun run --cwd evals eval:label-review --candidates <candidates> --labels <drafts> --verification <checks> --output-dir <new-golden-directory>`
- `ATLAS_EVAL_LIVE=1 bun run eval --suite code-quality/single-responsibility --live --dataset <manifest> --trials 3 --output-parent "$ATLAS_CONTEXT_DIR/evidence/evals"` (default pinned model; non-default model is an unpromotable comparison)
- `bun run --cwd evals eval:compare --baseline <baseline-run> --candidate <candidate-run>` requires same dataset/model conditions or reports comparison mismatch explicitly.

Do not commit credentials/private fixtures/artifacts; every dependency change uses Bun and main-owned lock updates. Installation/native build trust decisions happen only after implementation authorization and inspecting actual blocked lifecycle scripts.

## Measurements and acceptance
Report exact-match/per-field accuracy; TP/FP/TN/FN, precision/recall/F1/FPR and per-impact counts; abstention/decided coverage; unique cases/trials/repeat flip rate. Zero denominators are null with counts, not fabricated perfect scores. Ambiguous cases and operational errors are separate populations. When probabilities are available, optional calibration/Brier metrics use validated fields, not arbitrary confidence claims.

Measure monotonic preparation/inference/interpretation/grading/end-to-end and child startup/build overhead separately; report p50/p95 and sample count, provider/model/concurrency/cache conditions. A small starter corpus does not establish a latency SLA.

Fake/no-network tests cover success/quality regression, task/scorer throws, provider faults, invalid/missing answers, timeout/abort, import crash, empty/all-skipped/.only, missing/truncated/stale artifact, invalid score, duplicates/missing rows, repeats, overlapping invocations, exact score denominators, label leakage and real-home refusal. Installed real runner gate precedes any authorized live provider call. Model-backed efficacy remains separate from engineering tests and shipped binary builds.
