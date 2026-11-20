# evals — shared agent-oriented AI evaluation workspace

These are the canonical instructions for every agent that works in or runs the Atlas evals. Read this
file in full before you run any eval command. Nested instructions load only for touched paths, so a bash-only command
from the repo root does not load this file automatically.

## What this workspace is

Shared, development-only evaluation infrastructure for Atlas model-backed features. Code quality comes first.
Compaction and others follow. It is NOT a runtime package: nothing in packages/ or apps/ imports it, and it
never joins a shipped binary. Evalite owns scheduling and result storage. Atlas owns feature adapters,
integrity validation and compact reporting.

## Commands

Run every command from the repo root unless the text says otherwise. The default mode is fake, with no network. A run
NEVER contacts a model provider unless both `--live` and `ATLAS_EVAL_LIVE=1` are present.

```sh
bun run --cwd evals typecheck
bun run --cwd evals test

# default smoke materializes the synthetic calculator dataset in the invocation work dir (never real volume)
bun run eval --suite smoke --fake --trials 2 --output-parent "$ATLAS_CONTEXT_DIR/evidence/eval-smoke"
bun run --cwd evals eval:validate --manifest <accepted-manifest>

bun run --cwd evals eval:export-examples --session-dir <named-session-dir> [--session-dir <second>] --output-dir <new-export-dir>
bun run --cwd evals eval:curate --export-dir <sanitized-export> --output-dir <new-candidates-dir>
bun run --cwd evals eval:label-review --candidates <candidates.jsonl> --labels <drafts.jsonl> --verification <checks.jsonl> --dataset-version <new-version> --output-dir <new-golden-dir>
bun run --cwd evals eval:import-history --session-dir <named-session-dir> [--session-dir <second>] --output-dir <new-private-history-dir>

ATLAS_EVAL_LIVE=1 bun run eval --suite code-quality/single-responsibility --live --dataset <manifest> --trials 3 --output-parent "$ATLAS_CONTEXT_DIR/evidence/evals"
bun run --cwd evals eval:compare --baseline <run-dir> --candidate <run-dir>
bun run --cwd evals eval:efficacy --run <run-dir> --dataset <manifest> --judgments <judgments.jsonl> --output-dir <new-report-dir>
```

- The model defaults to the exported `JEV_QUALITY_MODEL` from `@dltech/atlas-core`. A `--model`
  argument with any other value marks the run not promotable.
- Live mode additionally requires `ATLAS_EVAL_DECISIONS_URL`, and optionally
  `ATLAS_EVAL_DECISIONS_TOKEN`. Missing endpoint configuration is a config error, never an implicit
  fallback.
- `eval:compare` requires an identical dataset version and hash, feature, requested model and mode. A
  mismatch is reported as an explicit comparison failure, and is not averaged over.
- `eval:efficacy` never executes the model. It replays a saved run against frozen judgments that were
  reviewed independently. It uses the production finding ledger for fresh-episode notification. It
  writes `report.json` / `report.txt`. It is a diagnostic that cannot promote a change. Zero
  denominators mean insufficient evidence, not success.
- `eval:import-history` reads ONLY `<session>/threads/*.events.jsonl` files that the command names
  explicitly. It writes raw, private source under a fresh 0700 directory. Its manifest marks that output unsanitized and not provider-ready.

## Modes and honesty

- A `mode=fake` run exercises real request preparation, the real JevDecisionClient leaf and real
  interpretation, with an injected transport. Its artifacts say `mode: "fake"`. Never report such a run
  as live efficacy.
- Engineering tests (`bun test`) are synthetic or fake only. Normal typecheck, test and build never start a
  model call.

## Artifact contract

Every run writes one fresh UUID directory under `--output-parent`. It never reuses or deletes an earlier run:
- `invocation.manifest.json` — written BEFORE the child starts: the code and adapter digests, the dataset
  hash, the enabled policy ids, the batch mode, the exact planned case, trial and variant ids, the
  deadlines, the mode and the start timestamp.
- `child.stdout.log` / `child.stderr.log` — complete child diagnostics.
- `evalite.raw.json` — the child's raw export, validated for freshness and cardinality before use.
- `results.jsonl` — normalized rows: expected/actual, status, scores, timing breakdown per row.
- `summary.json` + `summary.txt` — compact machine/agent summary. COMPLETE is marked only after integrity
  validation passes.

Exit codes: 0 = complete quality success, 1 = complete quality regression, 2 = a config, provider,
runtime or integrity failure. A process failure is never a deterministic grade of zero, and a grade of
zero is never a process failure.

The supervised child runs with its cwd in a gitignored `evals/.work/<uuid>/` folder INSIDE this workspace.
That location is required, because evalite and vitest resolve external modules from it. The folder
deliberately contains no `evalite.config.*`, so no config can load silently. Work folders accumulate.
Prune `evals/.work/` by hand when disk space matters.

## Datasets and labels

- Datasets are versioned. Each one holds manifest.json with the schema, input, expected, rubric and
  dataset versions, the content hash, the split, the exact case ids and the metric gates, plus
  cases.jsonl. `eval:validate` re-checks the hashes, the counts, the ids and the feature version
  agreement.
- Primary scoring accepts ONLY cases whose review state is `accepted`. A provisional or quarantined case is
  kept with its reason, and is left out of scoring.
- Expected labels are drafted offline and verified blind. The verifier sees the input and the rubric, never the candidate
  model output. `eval:label-review` refuses an unverified case. Changing a verified label needs a new
  dataset version, and the baseline AND the candidate run again.
- Real-session data enters only through `eval:export-examples`, from session dirs that the command names
  explicitly. The exporter verifies the digests, applies allowlisted redaction, parses the redacted
  text again, and records the redaction map. `eval:import-history` is the complementary strict path for historical replay. It may establish
  provable creation, or complete the before and after text, only from a proven same-log write or diff chain. It rejects
  opaque barriers, missing baselines and mismatching thread files. It does not read the disk state of today.
  Nothing ever scans ATLAS_HOME.
- Synthetic and fixture data lives under `evals/__fixtures__/` and is labelled synthetic. It is never counted
  as real-session volume.

## Reading results

Quality, operational failure and latency are separate dimensions. The terminal report and `summary.txt` give the
status, the unique case and trial counts, the error and inconclusive counts, the per-metric values and the baseline
deltas. They also give a few failure ids as expected -> actual, the total failure count and the artifact path. Ask for
a targeted failure by id. Do not dump a full artifact into the context window.

## Suite-specific instructions

- `code-quality/AGENTS.md` — SRP rubric, expected-label shapes, dataset layout.
