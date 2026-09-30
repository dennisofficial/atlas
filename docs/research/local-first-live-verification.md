# Local-first cloud serve: live verification

Verification date: 2026-09-30. Worktree tip `5358863d0` (`dennis/local-first-cloud`). Executed by
`packages/harness/spikes/live-local-first-smoke.ts` against the operator's real Vercel team, with
one disposable sandbox and one disposable drive whose UUID-derived names were printed before any
provider mutation. No runtime file changed; no commit was made.

## Result

**PASS.** A serve binary compiled from the current (unreleased) source provisioned, booted the
sealed portable-state bundle, answered authenticated `/v1/health`, completed the channel hello on
protocol 10 three times (initial, post-resume, post-restart), resumed with a stable serve token and
no local-state rewrite, and survived a stop/restart with the drive-held vault byte-identical
(compared by hash only). Sandbox and drive were destroyed and a name-scoped verify confirmed both
gone.

## What was proven

- **Provisioning and bootstrap are laptop-owned.** The driver created the drive and sandbox, wrote
  `bootstrap/workspace-spec.json` (all-null spec) and `bootstrap/local-state.json` before serve
  launched, and serve came up healthy without any Atlas Cloud contact (`ATLAS_CLOUD_URL` pointed at
  an unreachable host).
- **The portable-state contract round-trips.** The bundle carried one sealed Anthropic API-key
  account (fake key) whose secret was sealed with `sealWith` over an `accountSecretSchema` payload —
  not a raw string. Serve consumed the bundle at boot (file gone afterwards), materialized the
  vault (`auth.json`: one account, anthropic active pointer set), and did not rewrite the bundle on
  resume.
- **The current binary runs the session.** The image's baked serve was killed and replaced with the
  current build before first boot; health and hellos below ran against it. The swap is verifiable
  because the sandbox's `sha256sum` matched the local build's hash before the binary was moved into
  place.
- **Resume and restart semantics hold.** Re-`createOrResume` returned the same sandbox
  (`created=false`, token stable); after `stop()` the sandbox resumed from its snapshot with the
  drive re-attached and `auth.json` unchanged (hash compared, contents never read or printed).

## Transfer mechanics (what changed since the prior failed attempt)

- The prior attempt hung writing the 86MB binary through a single bulk `writeFiles`, and its
  runCommand base64 fallback hit the control plane's `Body exceeded 1mb limit` — command bodies are
  JSON and capped. The working transfer writes the binary as 22 x 4MB raw `Uint8Array` files, one
  `writeFiles` call each (gzip-compressed tar stream per request, no client-side buffering of the
  whole payload), then `cat`s the parts together in the sandbox and verifies the sha256 before the
  atomic `mv` into `/opt/atlas/atlas-serve`.
- **Vercel sandbox microVMs are x86_64**, not arm64. The first build
  (`bun-linux-arm64`, matching the Mac) transferred byte-identical but the kernel refused it —
  `Exec format error` when executed directly; the launcher runs the binary through `sh -c`, which
  surfaces it as `Syntax error: ")" unexpected`. The passing build is
  `bun scripts/build-serve.ts --target bun-linux-x64` (compiled inside a disposable
  `--platform linux/amd64` Docker container so the worktree was never installed into).

## Safety boundaries held

- The mandated `aws-secrets-manager` skill was requested first and is not installed; no AWS call,
  Secrets Manager access, or replacement secret workflow ran. Credentials resolved from the
  operator's local vault (Vercel token) plus team/project IDs read from the existing cloud session
  as authorized; no value was ever printed (a redaction set scrubbed every log line, and resource
  IDs `team_*`/`prj_*` were pattern-redacted regardless).
- The only credential injected into the sandbox was a fabricated `sk-ant-fake-…` string. No model,
  provider, or MCP request was issued: the smoke reads `/v1/health` and completes channel hellos
  only.
- Every resource was name-scoped to the synthetic thread (`atlas-thread-<uuid>`,
  `atlas-drive-<uuid>`), destroyed in a `finally`, and re-checked absent afterwards. Two earlier
  probe sandboxes (`atlas-probe-wf-*`, `atlas-probe-exec-*`) used for transfer/exec diagnosis were
  deleted in their own `finally` blocks. No pre-existing resource was touched.
- Local temp build artifacts (`/tmp/atlas-smoke/` binaries and probe scripts) were removed after
  evidence capture. The spike file and this document are the only repo changes.
