# @dltech/atlas-previews

One Cloudflare tunnel for each pod. The package reserves the rows that describe a pod's tunnel
and its hostnames, reconciles Cloudflare against those rows, and sweeps the tunnels and DNS
records that no row owns. The API's preview path and the `preview-reconcile` trigger task call it.

## Owns

- `PreviewTunnels`: the row-keeping side. It reserves the tunnel row and a route row for each
  exposed port, and it seals the tunnel token with a caller-supplied cipher.
- `CloudflareTunnelClient`: the Cloudflare API calls, with an injectable `fetch`.
- `preview-reconciler.ts`: the one pass that makes Cloudflare match the rows, and the orphan
  sweep.
- The hostname format `<port>-<label>.<domain>` and the tunnel name `atlas-<podSessionId>`. The
  domain comes from the caller.
- The errors that the caller maps to a status.

## Does not own

- The `cloudflared` process that carries the tunnel. The sandbox daemon owns it.
- The tunnel token that reaches the sandbox. `apps/api` owns that hand-off.
- Which sessions share a pod, and whether a pod still has a live session. The caller answers that
  through `livePeersOf`.
- The domain that a hostname uses. The caller supplies it.

## Entry points

| Import                   | Use it for                                                                      |
| ------------------------ | ------------------------------------------------------------------------------- |
| `@dltech/atlas-previews` | Tunnels, the reconciler, the Cloudflare client, the state names and the errors. |

## Capabilities

### Expose a port of a pod

- `new PreviewTunnels({ db, cipher, domain, cloudflare, livePeersOf? })`: builds the service.
  `livePeersOf(podSessionId)` counts the pod's live sessions and defaults to `async () => 0`.
- `expose({ podSessionId, threadId, userId, port })`: returns `{ url, tunnelToken }`. The first
  call for a pod inserts a `Pending` row, creates the tunnel outside any transaction, seals its
  token and moves the row to `Ready`. A repeated port returns the same hostname and makes no
  Cloudflare call.
- `markDeleting({ podSessionId })`, `clearDeleting({ podSessionId })`: one row update each, no
  Cloudflare call, safe to repeat.
- `teardown({ podSessionId })`: marks the row deleting and runs one reconcile pass over it. It
  answers `{ kind: 'deleted' }`, `{ kind: 'skipped' }` while another session of the pod is live,
  or `{ kind: 'failed', reason }` with the row kept for the next pass. It does not throw on a
  Cloudflare failure.

### Reconcile and sweep

- `reconcilePreviewTunnel(deps, { podSessionId })`: one pod. A `Deleting` row deletes its DNS
  records, then its tunnel, then its rows, and skips while a peer is live. A `Pending` or `Ready`
  row adopts or creates the tunnel by name, re-seals a lost token, creates or repoints each
  route's CNAME, writes the ingress, and stamps `syncedAt`.
- `previewPodsNeedingWork({ db }, { limit })`: the pods whose row is `Pending`, is `Deleting`, or
  was never synced, oldest `updatedAt` first.
- `runPreviewPass(deps, { log, limit?, podSessionIds? })`: the pass over those pods.
- `sweepPreviewOrphans(deps, { graceMs, dryRun })`: plans, then deletes, every `atlas-` tunnel and
  preview hostname that no row owns and that is older than `graceMs`.
- `new PreviewReconciler(deps)`: the same three as methods, `run`, `pass` and `sweep`, for a
  caller that builds the deps once, such as the agent host and the trigger task.

`PreviewReconcileDeps` is `{ db, cloudflare, domain, cipher, livePeersOf, now? }`.
`PreviewReconcileOutcome`, `PreviewPassSummary` and `PreviewOrphanSummary` are what one pod, one
pass and one sweep answer. The pass is row-driven: it never runs a Cloudflare call inside a
database transaction.

### Call Cloudflare

- `new CloudflareTunnelClient({ apiToken, accountId, zoneId }, { fetchFn? })`: builds the client
  from a `CloudflareConfig`.
- `createTunnel({ name })`, `putIngress({ tunnelId, rules })`.
- `findTunnelByName({ name })`, `getTunnel({ tunnelId })`, `tunnelToken({ tunnelId })`,
  `ensureTunnel({ name })`: find before create, so a crash between the Cloudflare object and the
  row recovers the tunnel instead of leaking another.
- `listTunnels({ namePrefix, page? })`, `listDnsRecords({ nameSuffix })`: paginated, for the
  sweep.
- `createCname({ hostname, tunnelId })`, `findDnsRecord({ hostname })`,
  `repointCname({ recordId, hostname, tunnelId })`, `deleteDnsRecord({ recordId })`.
- `deleteTunnel({ tunnelId })`.

### Name the row state

- `EPreviewTunnelState`: `Pending`, `Ready`, `Deleting`. The column is a plain `String`, so the
  union lives here rather than in the Prisma schema.

### Seal the token

- `PreviewSecretCipher`: `{ encrypt(plain), decrypt(blob) }`. The caller supplies it, so this
  package holds no key.

### Report a failure

- `CloudflareRecordExistsError`: Cloudflare reports a DNS record that already exists.
- `PreviewUpstreamError`: Cloudflare answered with an error or an unexpected body.

## Usage

```ts
import { livePodSessionsIn } from '@dltech/atlas-control/postgres'
import { CloudflareTunnelClient, PreviewTunnels } from '@dltech/atlas-previews'

const tunnels = new PreviewTunnels({
  db,
  cipher,
  domain: 'preview.example.dev',
  cloudflare: new CloudflareTunnelClient({ apiToken, accountId, zoneId }),
  livePeersOf: (podSessionId) => db.transaction((tx) => livePodSessionsIn({ tx, podSessionId })),
})

const reply = await tunnels.expose({
  podSessionId: 'ses_pod',
  threadId: 'thr-1',
  userId: 'usr-1',
  port: 3000,
})
// reply.url is https://3000-<label>.<domain>
await tunnels.markDeleting({ podSessionId: 'ses_pod' })
```

## Rules

- Keep one tunnel for each pod, named `atlas-<podSessionId>`. `expose` takes a per-pod advisory
  lock, so two concurrent calls make one tunnel and one route per port.
- Rows are desired state. Only the reconciler creates CNAMEs, writes ingress and deletes
  anything, and it runs its Cloudflare calls outside any transaction.
- Two drivers call the pass: the agent host after a row write, awaited, and the
  `preview-reconcile` trigger task every five minutes as the backstop, the sweep and the teardown
  executor.
- Inject `fetchFn` in a spec. Never call the real Cloudflare API in a test.

## See also

- `apps/trigger/src/previews/preview-reconcile.ts` for the pass's timer.
- `packages/previews/src/__tests__/preview-tunnels.spec.ts` and
  `packages/previews/src/__tests__/preview-reconciler.spec.ts` for the behaviour of each path.
