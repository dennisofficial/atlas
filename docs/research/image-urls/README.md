# Spike: images as signed private Vercel Blob URLs (2026-11-06)

Question: can the agent host send each image as a short-lived signed URL to a private Vercel Blob,
instead of inline base64, without losing correctness or prompt caching? Plan built on this:
[slices/media-urls.md](../../slices/media-urls.md).

## How it ran

`probe.ts` (with `creds.ts`) was run from `apps/agent-host/spike-image-urls/` against production,
using Dennis's active Anthropic and ChatGPT OAuth connections. It only read the tokens and never
refreshed them. Each run uploads a 1200×800 PNG (about 43 KB, a random red code word) to the
production Blob store with `access: 'private'`. It sends the same prompt (a ~18k-token system prefix
plus the image, `cacheControl` on the image) through the real `createAnthropicOauthModel`
(`claude-haiku-4-5`) and `createOpenAiModel` (`gpt-5.6-terra`, codex backend). Afterwards it
deletes the blob. Raw output from the last run: [results.json](results.json).

To run it again: copy both files into `apps/agent-host/spike-image-urls/`, export
`BLOB_READ_WRITE_TOKEN` from `apps/api/.env.production.enc`, then run
`bunx dotenvx run -f .env.production.enc -- bun spike-image-urls/probe.ts` from `apps/agent-host`.

## Findings

| #   | Request                                   | Anthropic                         | OpenAI (codex)                  |
| --- | ----------------------------------------- | --------------------------------- | ------------------------------- |
| 1   | Signed URL A, cold                        | reads it; cache write 21,086      | reads it                        |
| 2   | URL A again                               | cache read 21,086                 | reads it; cached 0              |
| 3   | URL B (same bytes, re-signed, new string) | **cache read 21,086**             | reads it; cached 0              |
| 4   | Same bytes as base64                      | **cache read 21,086**             | reads it; cached 0              |
| 5   | 40 s URL, still valid                     | cache read                        | reads it                        |
| 6   | That URL after expiry, fetched before     | **still works**, cache read       | 400 `Upstream status code: 403` |
| 7   | Expired URL, never fetched                | 400 `Unable to download the file` | 400 `Upstream status code: 403` |
1. **Both providers fetch a private signed Vercel Blob URL.** No redirect, `content-type: image/png`.
   The URL is 482 characters on `<store>.private.blob.vercel-storage.com`, with query keys
   `vercel-blob-delegation` and `vercel-blob-signature`.
2. **Anthropic keys its prompt cache on image content, not on the URL.** A re-signed URL, and even
   base64 of the same bytes, read the cache written by URL A. So re-signing never costs an
   Anthropic cache hit.
3. **Anthropic also keeps a URL→bytes cache of its own.** An expired URL it had already downloaded
   still worked (row 6); one it had never seen failed (row 7). This is undocumented, so nothing may
   depend on it.
4. **OpenAI downloads on every request.** An expired URL fails the whole request with a 400, so
   every request must carry URLs that are still valid.
5. **Codex caching could not be measured.** The codex backend reported `cached_tokens: 0` for
   every repeat, including text-only repeats with a fixed `promptCacheKey`, so the spike says
   nothing about OpenAI's cache keying. Deterministic URLs (finding 8) are the hedge.
6. **The image read the same either way.** Codex answered `KESTREL` instead of `KESTREL-6498` in all
   five valid rows, base64 included. That is the model's reading, not the transport. Latency showed
   no difference between URL and base64 at this size.
7. **Signing is cheap once the delegation is held.** `issueSignedToken` is a network call (10–44 ms).
   `presignUrl` is a local HMAC (about 0.1 ms each, 1000 in 100 ms). A delegation scoped to `'*'`
   signs any pathname. Changing the path under a valid signature gives 403. Prefix or glob scopes
   are rejected: the scope is one exact pathname or `'*'`.
8. **`presignUrl` is deterministic.** One delegation plus the same `validUntil` gives a
   byte-identical URL. A new delegation gives a different URL.
9. **A delegation lives at most 7 days.** `issueSignedToken` rejects a longer `validUntil` with
   "validUntil cannot be more than 7 days after the request time". 1, 6 and 6.9 days were accepted,
   and their URLs served the blob.
10. **The ChatGPT account cannot use `gpt-5.5`** (`model_not_found`). Its listed models are the
    `gpt-5.6-*` and `gpt-6*` families. This doesn't matter for images; noted for the next probe.

## Consequences for the design

- Sign once per 6-day window with one `'*'` read delegation valid for 7 days, stored in Postgres
  so every host uses the same one. URLs stay byte-identical for the whole window, which covers
  OpenAI whatever its cache keys on. The worst case is one cache miss per session per 6 days.
- Sign at request build time, never store a URL in an event. Every URL handed out has at least a
  day before it expires.
- Check each image once, when it is stored. A bad URL or a bad image fails the whole request on
  both providers.
