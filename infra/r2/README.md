# R2 bucket CORS

`cors.json` is the source of truth for the CORS rules on the Cloudflare R2 buckets that a browser
reads directly. Today that is `atlas-artifacts`: the web and Mac apps `fetch` signed change-content
URLs from it for the session Changes tab (`apps/web/src/features/sessions/changes/use-changed-file.ts`).
Without a rule R2 sends no `Access-Control-Allow-Origin`, and the browser reports "Failed to fetch".

Apply it, then confirm the live rules match:

```sh
CLOUDFLARE_ACCOUNT_TOKEN=… bun scripts/r2-cors.ts          # apply and read back
CLOUDFLARE_ACCOUNT_TOKEN=… bun scripts/r2-cors.ts --check  # read only; exits 1 on drift
```

The token needs R2 admin access. The `ARTIFACT_S3_*` keys cannot read or write bucket CORS.

## Origins

| Origin                       | Reader                                                      |
| ---------------------------- | ----------------------------------------------------------- |
| `https://byatlas.io`         | production web                                              |
| `http://127.0.0.1*`          | Mac app, which serves the web app on a random loopback port |
| `http://localhost:3001`      | local `web` service                                         |
| `https://3001-*.byatlas.dev` | the `web` service previewed from a cloud sandbox            |

R2 does not accept a wildcard in a port ([docs](https://developers.cloudflare.com/r2/buckets/cors/#common-issues)),
so the Mac origin is `http://127.0.0.1*`. It also matches hosts such as `127.0.0.1.example.com`.
That is acceptable: a signed URL is itself the read credential, and CORS only decides which pages
may read it from script.

Only `GET` and `HEAD` are allowed. Uploads to the bucket (artifact pushes, change content) come from
the pod and the API, not from a browser. Media and composer uploads use Vercel Blob, which answers
every origin already.
