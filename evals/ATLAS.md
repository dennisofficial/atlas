# evals — shared agent-oriented AI evaluation workspace

Canonical instructions for every agent working in or running the Atlas evals. Read this file in full
before running any eval command — nested instructions load only for touched paths, so a bash-only command
from the repo root does NOT load this automatically.

## What this workspace is

Shared, development-only evaluation infrastructure for Atlas model-backed features (code quality first,
compaction and others later). It is NOT a runtime package: nothing in packages/ or apps/ imports it, and it
never joins a shipped binary. Evalite owns scheduling and result storage; Atlas owns feature adapters,
integrity validation and compact reporting.

## Commands

All run from the repo root unless noted. Default mode is fake/no-network; a run NEVER contacts a model
provider unless both `--live` and `ATLAS_EVAL_LIVE=1` are present.

```sh
bun run --cwd evals typecheck
bun run --cwd evals test

# default smoke materializes the synthetic calculator dataset in the invocation work dir (never real volume)
bun run eval --suite smoke --fake --trials 2 --output-parent "$ATLAS_CONTEXT_DIR/evidence/eval-smoke"
bun run --cwd evals eval:validate --manifest <accepted-manifest>

bun run --cwd evals eval:export-examples --session-dir <named-session-dir> [--session-dir <second>] --output-dir <new-export-dir>
bun run --cwd evals eval:curate --export-dir <sanitized-export> --output-dir <new-candidates-dir>
bun run --cwd evals eval:label-review --candidates <candidates.jsonl> --labels <drafts.jsonl> --verification <checks.jsonl> --dataset-version <new-version> --output-dir <new-golden-dir>

ATLAS_EVAL_LIVE=1 bun run eval --suite code-quality/single-responsibility --live --dataset <manifest> --trials 3 --output-parent "$ATLAS_CONTEXT_DIR/evidence/evals"
bun run --cwd evals eval:compare --baseline <run-dir> --candidate <run-dir>
```

- The model defaults to the exported `JEV_QUALITY_MODEL` from `@dltech/atlas-core`. Passing `--model`
  anything else marks the run not promotable.
- Live mode additionally requires `ATLAS_EVAL_DECISIONS_URL` (and optionally `ATLAS_EVAL_DECISIONS_TOKEN`).
  Missing endpoint configuration is a config error, never an implicit fallback.
- `eval:compare` requires identical dataset version/hash, feature, requested model and mode; a mismatch is
  reported as an explicit comparison failure, not averaged over.

## Modes and honesty

- `mode=fake` runs exercise real request preparation, the real JevDecisionClient leaf and real
  interpretation with an injected transport. Their artifacts say `mode: "fake"` and must NEVER be reported
  as live efficacy.
- Engineering tests (`bun test`) are synthetic/fake only. Normal typecheck/test/build never initiates a
  model call.

## Artifact contract

Every run writes one fresh UUID directory under `--output-parent` (never reuses or deletes earlier runs):

- `invocation.manifest.json` — written BEFORE the child starts: code/adapter digests, dataset hash,
  enabled policy ids, batch mode, exact planned case/trial/variant ids, deadlines, mode, start timestamp.
- `child.stdout.log` / `child.stderr.log` — complete child diagnostics.
- `evalite.raw.json` — the child's raw export (freshness/cardinality-validated before use).
- `results.jsonl` — normalized rows: expected/actual, status, scores, timing breakdown per row.
- `summary.json` + `summary.txt` — compact machine/agent summary. COMPLETE is marked only after integrity
  validation passes.

Exit codes: 0 = complete quality success, 1 = complete quality regression, 2 = config/provider/runtime/
integrity failure. A process failure is never a deterministic grade zero and vice versa.

The supervised child runs with cwd in a gitignored `evals/.work/<uuid>/` folder INSIDE this workspace —
that location is load-bearing (external module resolution for evalite/vitest), and the folder deliberately
contains no `evalite.config.*` so no config can silently load. Work folders accumulate; prune
`evals/.work/` manually when disk matters.

## Datasets and labels

- Datasets are versioned: manifest.json (schema/input/expected/rubric/dataset versions, content hash,
  split, exact case ids, metric gates) + cases.jsonl. `eval:validate` re-verifies hashes, counts, ids and
  feature version agreement.
- Primary scoring accepts ONLY review-state `accepted` cases. Provisional/quarantined cases are preserved
  with reasons but excluded.
- Expected labels are drafted offline and verified blind (verifier sees input/rubric, never the candidate
  model output). `eval:label-review` refuses unverified cases. Changing a verified label means a new
  dataset version and rerunning baseline AND candidate.
- Real-session data enters only via `eval:export-examples` from explicitly named session dirs — the
  exporter verifies digests, applies allowlisted redaction, re-parses redacted text, and records the
  redaction map. Nothing ever scans ATLAS_HOME.
- Synthetic/fixture data lives under `evals/__fixtures__/` and is labelled synthetic; it is never counted
  as real-session volume.

## Reading results

Quality, operational failure and latency are separate dimensions. The terminal/summary reports status,
unique cases/trials, error and inconclusive counts, per-metric values and baseline deltas, a handful of
failure ids (expected -> actual), total failure count and the artifact path. Request targeted failures by
id rather than dumping full artifacts into context.

## Suite-specific instructions

- `code-quality/ATLAS.md` — SRP rubric, expected-label shapes, dataset layout.
