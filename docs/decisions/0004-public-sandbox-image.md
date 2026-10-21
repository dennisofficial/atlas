# 0004. The sandbox image is public on GHCR

Accepted 2026-10-19.

## Context

Local pods pull `ghcr.io/dennisofficial/atlas-sandbox`. While the package was private, a pull
needed a GitHub token, and the plan carried a fallback that logged Docker in with `gh auth token`.

## Decision

The GHCR package is public. Pods pull it anonymously: `DockerEngine.createContainer` asks the
daemon for `/images/create?fromImage=...` with no registry credentials
(`packages/harness/src/execution/docker/engine.ts`,
`packages/harness/src/execution/docker/image-pull.ts`).

## Why

The image is a runtime toolkit with nothing secret or Atlas-versioned in it; serve is downloaded
into the pod at boot. Anonymous pulls remove a credential dependency from every pod birth.

## Consequences

- No gh-token pull fallback exists.
- GHCR publishes `sha-<7>` and `latest` per merge, multi-arch (`.github/workflows/sandbox-image.yml`).
- Vercel still needs its own copy in VCR (`linux/amd64`, `latest` only), because Vercel Sandbox
  pulls only from there.
