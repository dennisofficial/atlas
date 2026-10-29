# Decision records

One file per durable decision: context, decision, reason, consequences. Records are numbered in
the order they were accepted and are not edited once a later record replaces them; the later one
says what it supersedes. Tactical choices and decisions that were later reversed are not recorded.

`docs/pods.md` describes the system these decisions produced.

| #    | Decision |
| ---- | -------- |
| [0001](0001-pods-not-sandboxes.md) | The per-session container is a pod; the provider is a runner |
| [0002](0002-docker-is-the-only-local-engine.md) | Docker, through the Engine API, is the only local engine |
| [0003](0003-local-pod-security-boundary.md) | Local pods run privileged, with only their own named volumes |
| [0004](0004-public-sandbox-image.md) | The sandbox image is public on GHCR and pulled anonymously |
| [0005](0005-api-owns-oauth-tokens.md) | The API owns OAuth model tokens; pods lease access tokens |
| [0006](0006-ssh-signing-key-replaces-gpg.md) | A per-user SSH signing key replaces the GPG export |
| [0007](0007-pod-home-label.md) | Local pods carry the hash of the Atlas home that owns them |
| [0008](0008-no-api-preview-environments.md) | The API has no preview environments |
| [0009](0009-memory-is-rows-behind-tools.md) | Memory is database rows behind tools, and starts empty |
| [0010](0010-projects-resolved-from-origin.md) | A pod's workspace comes from a Project, found by the origin remote |
| [0011](0011-explicit-atlas-push.md) | Skills, instructions and MCP config reach pods by `atlas push` |
| [0012](0012-cloud-state-starts-empty.md) | Pod mode starts empty: no import, no old threads |
| [0013](0013-pods-behind-a-flag.md) | Pods sit behind `experimental.pods`; the TUI stays local, the web goes cloud-first |
| [0014](0014-local-pod-principal-is-sandbox-reach.md) | A local pod's token reaches what a Vercel pod's does, minus the Vercel-only controls |
