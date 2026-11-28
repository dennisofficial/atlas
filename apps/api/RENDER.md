# Render workarounds

The API runs on Render (service `atlas-api`, see `docs/decisions/0030-api-and-agent-host-are-one-render-service.md`).
Render puts an edge web application firewall (WAF) in front of every service. We cannot configure
it or turn it off. It reads request bodies and answers `403` with an HTML "Blocked" page when a body
looks like an attack: shell commands such as a backticked `` `curl https://…` `` or
`` `wget https://…` ``, and file paths. The request never reaches the API, so the API logs nothing.

Atlas sends shell commands and paths in normal work, so we wrap request bodies in base64. The WAF
has nothing to match in base64.

If the API moves off Render, remove each workaround below. Before you remove one, check that the
new host does not filter request bodies: send the blocked text as a plain JSON body and expect the
API's own answer (for example `401`), not a `403` from the edge.

```sh
jq -nc --arg b '`curl https://example.com`' '{b:$b}' |
  curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.byatlas.io/v1/github/app/hook \
    -H 'content-type: application/json' --data-binary @-
```

## 1. tRPC bodies (`atlasB64`), since #2410

Every client call through `createApiClient` (web, Mac, mobile, TUI, the composer) sends its JSON
body as `{ "atlasB64": "<base64 of the body>" }`.
- Client: `encodeBody` and `base64OfUtf8` in `packages/api-router/src/client.ts`.
- API: `decodeAtlasB64Body` in `apps/api/src/_lib/atlas-b64-body.ts`, mounted on `/v1/trpc` in
  `apps/api/src/create-app.ts`.
- Body cap: `JSON_BODY_LIMIT` in `apps/api/src/_lib/body-limits.ts` went up to `8mb` to absorb the
  33% base64 overhead. Lower it again when the wrapping goes.
- Test fakes that unwrap the body: `apps/web/src/lib/__tests__/trpc-body.ts` and its callers.

Cleanup order: stop the client wrapping first and ship it to every client. Remove the API unwrap
only after the installed TUI and Mac builds no longer send `atlasB64`, because the API must accept
what released clients send.

## 2. GitHub App webhooks (`apps/github-hook-relay`)

GitHub sends the PR body with every pull-request webhook. One PR body with a backticked `curl`
made Render block every webhook of that PR (trycompai/comp-v2#1153, 116 deliveries, 2026-11-24).
GitHub signs the raw bytes, so a client-side wrap is not possible. A Cloudflare Worker wraps them.
- Worker: `apps/github-hook-relay` at `https://hooks.byatlas.io/github/app`. It sends
  `{ "payload": "<base64 of GitHub's body>" }` and GitHub's delivery headers to the API. It holds
  no secret.
- API: `POST /v1/github/app/relayed-hook` (`handleRelayedDelivery` in
  `apps/api/src/api/cloud/github/github-app-hook.controller.ts`) decodes the payload and checks
  GitHub's signature over the decoded bytes, then runs the same steps as `POST /v1/github/app/hook`.
- Deploy: job `deploy-github-hook-relay` in `.github/workflows/release.yml`, repo secret
  `HOOK_RELAY_DOTENV_PRIVATE_KEY`, tier file `apps/github-hook-relay/.env.production.enc`.
- GitHub App setting: the webhook URL of the `atlas-by-dl` App points at the Worker.

Cleanup order: set the App webhook URL back to `https://<api host>/v1/github/app/hook` and confirm
deliveries arrive. Then delete the Worker (Cloudflare script `atlas-github-hook-relay` and its
`hooks.byatlas.io` custom domain), `apps/github-hook-relay`, the release job, the repo secret and
the `relayed-hook` route.

Per-repo hooks (`POST /v1/github/hooks/:repo`) do not go through the relay. No repo uses one today
(`GithubRepoHook` is empty). If one comes back while the API is on Render, it needs the relay too.
