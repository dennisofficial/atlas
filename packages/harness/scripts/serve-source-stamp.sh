#!/bin/sh
# The one source-hash recipe both the api image (apps/api/Dockerfile) and the VCR sandbox image
# (sandbox-image.yml) stamp the serve binary with, so a sandbox whose baked serve matches the
# deployment's source reuses it instead of re-downloading ~91MB on every boot. Hash the source,
# not the compiled binary: `bun build --compile` is not byte-reproducible, so a binary hash would
# churn the stamp and force a fleet-wide re-download on every deploy even when nothing changed.
# Run from the repo root.
set -eu
find packages/harness/src packages/core/src -type f | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -d' ' -f1
