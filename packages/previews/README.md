# @dltech/atlas-previews

A preview tunnel for a thread. The package opens one Cloudflare tunnel for each thread, adds a
hostname for each port that the thread exposes, and removes everything on teardown. The API's
preview server calls it.

## Owns

- `PreviewTunnels`: the row-keeping side. It creates the tunnel, the DNS record and the ingress
  rules, and it seals the tunnel token with a caller-supplied cipher.
- `CloudflareTunnelClient`: the Cloudflare API calls, with an injectable `fetch`.
- The hostname format `<port>-<label>.<domain>`. The domain comes from the caller.
- The errors that the caller maps to a status.

## Does not own

- The local process that talks to the tunnel. The sandbox agent owns it.
- The tunnel token that reaches the sandbox. `apps/api` owns that hand-off.
- The domain that a hostname uses. The caller supplies it.

## Entry points

| Import                   | Use it for                                     |
| ------------------------ | ---------------------------------------------- |
| `@dltech/atlas-previews` | Tunnels, the Cloudflare client and the errors. |

## Capabilities

### Expose and tear down a thread

- `new PreviewTunnels({ db, cipher, domain, cloudflare })`: builds the service.
- `expose({ threadId, userId, port })`: returns `{ url, tunnelToken }`. The first call creates the
  tunnel and the CNAME. A repeated port returns the same URL.
- `teardown({ threadId })`: deletes the DNS records, the tunnel and the rows. It does nothing when
  the thread has no tunnel.

### Call Cloudflare

- `new CloudflareTunnelClient({ apiToken, accountId, zoneId }, { fetchFn? })`: builds the client.
- `createTunnel({ name })`: returns `{ id, token }`.
- `putIngress({ tunnelId, rules })`: writes the ingress rules and the catch-all last rule.
- `createCname({ hostname, tunnelId })`, `findDnsRecord({ hostname })`,
  `repointCname({ recordId, hostname, tunnelId })`, `deleteDnsRecord({ recordId })`.
- `deleteTunnel({ tunnelId })`.

### Seal the token

- `PreviewSecretCipher`: `{ encrypt(plain), decrypt(blob) }`. The caller supplies it, so this
  package holds no key.

### Report a failure

- `CloudflareRecordExistsError`: Cloudflare reports a DNS record that already exists.
  `PreviewTunnels` reuses that record, or it repoints the record to its own tunnel.
- `PreviewUpstreamError`: Cloudflare answered with an error or an unexpected body.

## Usage

```ts
const reply = await tunnels.expose({ threadId: 'thr-1', userId: 'usr-1', port: 3000 })
// reply.url is https://3000-<label>.byatlas.dev
```

## Rules

- Keep one tunnel for each thread. `expose` takes a per-thread lock, so two concurrent calls make
  one tunnel.
- Call `teardown` when the thread is archived or deleted.
- Inject `fetchFn` in a spec. Never call the real Cloudflare API in a test.

## See also

- `apps/api/src/api/platform/sandboxes/preview-tunnel.service.ts` for the caller.
- `packages/previews/src/__tests__/preview-tunnels.spec.ts` for the behaviour of each path.
