# install.byatlas.io

The Cloudflare Worker behind `https://install.byatlas.io`, the public install URL for the `atlas`
binary. It proxies `install.sh` from this repo:

- `/` serves `install.sh` from `main`.
- `/tui-v<version>` serves `install.sh` as of that release tag, for pinned installs.
- Responses are edge-cached for 5 minutes.

## Deploy

The Worker lives on the Cloudflare account holding the `byatlas.io` zone, deployed over the API
with a token carrying Workers Scripts: Edit on that account:

```sh
curl -X PUT -H "Authorization: Bearer $CF_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/workers/scripts/install-byatlas-io" \
  -F 'metadata={"main_module":"worker.js","compatibility_date":"2026-09-22"};type=application/json' \
  -F 'worker.js=@worker.js;type=application/javascript+module'
```

The custom domain `install.byatlas.io` is attached to the script (Workers → install-byatlas-io →
Domains); the attachment owns the proxied DNS record.
