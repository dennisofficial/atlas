# install.byatlas.io

The Cloudflare Worker behind `https://install.byatlas.io`: the public install URL for `atlas` and
every release download the clients read. Nothing here needs a GitHub login, so the repository can
be private or change owner without breaking an installed copy.

## Routes

| Path                               | Serves                                                    |
| ---------------------------------- | --------------------------------------------------------- |
| `/`                                | `install.sh` from `main` of this repo.                    |
| `/tui-v<version>`                  | `install.sh` as of that release tag, for pinned installs. |
| `/releases/latest/download/<name>` | `<name>` from the tag `index.json` names latest.          |
| `/releases/download/<tag>/<name>`  | `<name>` from that tag.                                   |
| `/releases/tags`                   | `{"tags": [...]}` for the TUI update check.               |

Release assets come from the R2 bucket `atlas-releases`, keyed `releases/<tag>/<name>`, with
`index.json` holding `{"latest": "<tag>", "tags": [...]}`. An asset the bucket does not hold yet is
fetched from the GitHub release of the same tag, so a tag mirrored late still answers; once the
bucket holds it, GitHub is never touched. `install.sh` responses are edge-cached for 5 minutes,
`latest` paths for 60 seconds, tagged assets for an hour.

Every release uploads itself: `.github/workflows/ci.yml` (binaries and Mac app),
`.github/workflows/web-ota.yml` (the Mac app's web payload) and the deploy below all use
`scripts/mirror-release.ts`, which uploads the GitHub release's assets, moves `index.json`, and
verifies each asset answers at the mirror URL with the same bytes.

## Deploy

`scripts/install-worker/deploy.ts` uploads `worker.js` over the API with the R2 binding, reads its
credentials from `.env.production.enc`, and fails unless `https://install.byatlas.io/releases/tags`
answers afterwards:

```sh
DOTENV_PRIVATE_KEY_PRODUCTION_ENC=... \
  bunx dotenvx run -f scripts/install-worker/.env.production.enc -- bun scripts/install-worker/deploy.ts
```

`.github/workflows/release.yml` runs exactly that when `scripts/install-worker/` changes. The token
needs Workers Scripts: Edit and Workers R2 Storage: Edit on the account holding `byatlas.io`.

The custom domain `install.byatlas.io` is attached to the script `install-byatlas-io` (Workers →
install-byatlas-io → Domains). The attachment lives on the script, not on this deploy, so a deploy
never moves the hostname.
