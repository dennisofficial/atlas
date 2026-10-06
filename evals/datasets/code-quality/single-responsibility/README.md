# code-quality/single-responsibility dataset

Skeleton only. `manifest.json` + `cases.jsonl` here are placeholders: the manifest declares zero accepted
cases and a content hash matching the empty cases file, so the dataset validates structurally but is not a
calibration claim. Real curated cases arrive through the curation pipeline:

1. `eval:export-examples` from explicitly named session dirs (sanitizing export).
2. `eval:curate` into candidates.
3. Offline expected-label drafting plus independent blind verification.
4. `eval:label-review` into an accepted golden dataset with a new `datasetVersion`.

Private corpora stay outside the repository; this directory holds only reviewed, public-safe accepted examples.
