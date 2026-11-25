# Quality rules: rule v2 tuning and holdout v2 (2026-11-23)

- `dev-tuning-report.md`: rule v2 thresholds picked on the development set (baseline plus holdout v1, 121 cases per rule).
- `<rule>.cases.jsonl`: the fresh real-code holdout. Code from third-party repositories is stored as `{ref, path}` plus `repository`.
- `<rule>.{blind,accepted,quarantine}-labels.jsonl`: the blind labels, the accepted labels, and the quarantined cases with both rationales.
- `<rule>-report.md`: one live run on `gateway/typesafe-ai/jev` with the frozen thresholds (silent failure 0.8/0.4, open/closed 0.9/0.5).
- `srp-shared-request-report.md`: single responsibility answered alone and answered in the shared three-policy request.
