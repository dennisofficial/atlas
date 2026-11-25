# Quality rules holdout (2026-11-23)

Holdout datasets for the silent-failure and open/closed rules (`docs/slices/quality-rules.md` §5.3), with blind labels and the first live run on `gateway/typesafe-ai/jev`.
- `<rule>.cases.jsonl`: synthetic cases and cases from this repository carry the full `before` and `after` text. Cases from other public repositories carry `{ref, path}` plus `repository` instead of the text, so their source is not copied here. Fetch it with `git show <ref>:<path>`.
- `<rule>.blind-labels.jsonl`: blind labels. `<rule>.accepted-labels.jsonl`: cases where the blind label and the draft agree on `notify`. `<rule>.quarantine.jsonl`: disagreements, with both rationales.
- `<rule>-report.md`: the live run, 3 trials. `<rule>-findings.md`: the analysis.

Both rules fail the ship bar as specified. See the findings files.
