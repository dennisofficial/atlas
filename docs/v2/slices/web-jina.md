# web: Jina as the platform backend for web_search and web_fetch

Status: **spec, 2026-11-24.** Anchors are `path:line` at `216f9d88a`. Dennis approved the switch to
Jina, the no-BYOK rule and the Jina-first order on 2026-11-24.

## Goal

`web_search` and `web_fetch` in v2 call Jina AI (`s.jina.ai`, `r.jina.ai`) with one platform key.
Users bring no key and choose no backend. Bing, the backend setting, `web.searchKey` and the
`search.<backend>` secrets are deleted. There is no budget cap.

## Settled decisions

- **Jina first, direct fetch as the fallback (web_fetch).** Jina renders JS, reads PDFs, runs OCR and
  applies selectors. Our direct fetch (`plugins/web/src/pod/fetch-page.ts:100`) runs only when Jina
  cannot answer: no key, a network error, a timeout, a Jina 5xx, a 429, a 401 or a 402. It does not
  run when Jina reports a fact about the target (DNS failure, the target's 404), because a direct
  fetch gets the same answer.
- **The call runs on the agent host, not in the pod.** Plugin pod tools already run on the host
  (`fetch-page.ts:119` is a host `fetch`). The key stays in the API env, never in the sandbox, so an
  agent cannot read it, and Vercel and Agent37 pods behave the same.
- **One search port.** `SearchPort { search(request): Promise<SearchOutcome> }` and a `ReaderPort`
  for the fetch side. Jina is one adapter of each. A later swap is one adapter and one line.
- **No caps.** No `X-Token-Budget` (it answers 409 when exceeded instead of truncating). The
  existing body cap in `fetch-page.ts` still bounds what enters the context.
- **No Agent37 budget code.** The Agent37 managed-search work is dropped. All 54 Agent37 instances
  were reset to `monthly_cap_micros: 0` on 2026-11-24.

## Evidence (probed 2026-11-24 with the platform key)

| Probe                                                         | Result                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------- |
| `s.jina.ai` "Bun 1.4.5 release notes", default                | 200, 4.5 s, 170k tokens (page text of each result)        |
| same with `X-Respond-With: no-content`                        | 200, 1.3 s, 2k tokens, title + url + description          |
| quoted query with no match                                    | 422 `AssertionFailureError` "No search results available" |
| `X-Site: zod.dev`                                             | only zod.dev results                                      |
| `tbs=qdr:w`                                                   | results of the last week                                  |
| `r.jina.ai` arxiv PDF                                         | 200, 0.3 s, 40k chars of text                             |
| PDF with `X-Respond-With: jina-ocr`, `X-Page: 2`              | 200, 4.5 s, page 2 only                                   |
| `X-Target-Selector: article`, `X-Remove-Selector: nav,footer` | 200, article body only                                    |
| `X-Engine: browser` on posthog.com/pricing                    | 200, **77 s**                                             |
| iso.org (403 to our direct fetch today)                       | 200 through Jina                                          |
| target 404                                                    | Jina 200 with `httpStatus: "404"` and `warning`           |
| unknown host                                                  | 422 `SubmittedDataMalformedError` "could not be resolved" |
| localhost                                                     | 403 `LocalhostAccessError`                                |
| bad key                                                       | 401 `AuthenticationFailedError`                           |

## web_fetch error causes today (v2, 2026-11-20 to 2026-11-24)

130 of 689 calls failed (18.9%). Source: `v2."V2Event"` tool-result events; the spans carry no
error text. Full table: `$ATLAS_CONTEXT_DIR/sections/02-web-fetch-errors.md`.

| Cause                                                               | Share | Ours?   | What this change does                                                               |
| ------------------------------------------------------------------- | ----- | ------- | ----------------------------------------------------------------------------------- |
| Target 404 on a guessed doc URL                                     | 65%   | No      | Error says the page does not exist and to find the url with `web_search`            |
| `pattern` with `(?i)` rejected (`packages/core/src/web/find.ts:26`) | 20%   | **Yes** | Strip a leading inline-flag group. Separate small PR, as briefed                    |
| 403 bot wall                                                        | 10%   | No      | Jina gets through (iso.org); otherwise the error names `render: true` and `browser` |
| DNS, timeout, 530                                                   | 5%    | No      | One clear sentence                                                                  |

Expected after both PRs: the regex share goes to 0 and part of the 403 share goes. The 404 share
depends on the model searching before it guesses; the measure is the same query after a week.

## Tools

| Jina MCP tool (`mcp.jina.ai/v1` tools/list)                                | Atlas        | Why                                                       |
| -------------------------------------------------------------------------- | ------------ | --------------------------------------------------------- |
| `search_web`                                                               | `web_search` | Core need                                                 |
| `read_url`                                                                 | `web_fetch`  | Core need; adds PDF pages, JS rendering and selectors     |
| `capture_screenshot_url`                                                   | no           | `browser` already takes screenshots                       |
| `search_images`                                                            | no           | No use case seen                                          |
| `search_arxiv`, `search_ssrn`, `search_jina_blog`                          | no           | `web_search` with `site` covers them                      |
| `extract_pdf` (figures)                                                    | no           | arXiv-type hosts only                                     |
| `sort_by_relevance`, `deduplicate_strings`, `guess_datetime_url`, `primer` | no           | The model does this itself, or the harness gives the date |

### web_search parameters

| Parameter                                                  | Where         | Why                                                                        |
| ---------------------------------------------------------- | ------------- | -------------------------------------------------------------------------- |
| `query`                                                    | schema        | Required                                                                   |
| `count` (default 8, max 20) → `num`                        | schema        | Exists today                                                               |
| `site` → `X-Site`                                          | schema        | Docs searches are the main use                                             |
| `fresh` (`hour`/`day`/`week`/`month`/`year`) → `tbs=qdr:*` | schema        | Release notes and news                                                     |
| `gl` (country)                                             | schema        | Cheap, clear                                                               |
| `hl`, `location`                                           | excluded      | Rare, the model guesses wrong                                              |
| `X-Respond-With: no-content`                               | house default | 1.3 s and 2k tokens instead of 4.5 s and 170k; read pages with `web_fetch` |
| `Accept: application/json`                                 | house default | Structured results                                                         |

A 422 on a query with quotes retries once with the quotes removed. A 422 with no quotes is "no
results", not an error.

### web_fetch parameters

| Parameter                                                                                                          | Where         | Why                                                                |
| ------------------------------------------------------------------------------------------------------------------ | ------------- | ------------------------------------------------------------------ |
| `url`, `pattern`, `timeout`                                                                                        | schema        | Exist today. `timeout` → `X-Timeout`                               |
| `format` → `X-Return-Format` (`markdown`/`text`/`html`)                                                            | schema        | Exists today                                                       |
| `selector` → `X-Target-Selector`                                                                                   | schema        | Read one part of a long page                                       |
| `remove` → `X-Remove-Selector`                                                                                     | schema        | Drop nav and footers                                               |
| `waitFor` → `X-Wait-For-Selector`                                                                                  | schema        | Pages that load content late                                       |
| `render` (boolean) → `X-Engine: browser`                                                                           | schema        | JS-only pages. The description says it can take over a minute      |
| `page` → `X-Respond-With: jina-ocr` + `X-Page`                                                                     | schema        | One page of a long or scanned PDF                                  |
| `X-Retain-Images: none`                                                                                            | house default | Image links are noise for the model                                |
| `Accept: application/json`                                                                                         | house default | Gives `httpStatus`, `warning`, `title`                             |
| `X-No-Cache`, `X-Cache-Tolerance`, `X-Respond-Timing`, `X-No-Gfm`, `DNT`, `X-With-Generated-Alt`, `X-Token-Budget` | excluded      | Jina defaults are right; alt text and budgets add cost or failures |
| `X-Set-Cookie`, `X-Proxy`, `X-Proxy-Url`, `X-User-Agent`, `X-Referer`                                              | excluded      | Credentials and identity spoofing; never in the schema             |

## The key

`JINA_API_KEY` is in `apps/api/.env.production.enc` and `apps/api/.env.local.enc` (encrypted with
`dotenvx set`). It is optional in the env schema: a new section next to
`apps/api/src/_core/config/env/sections/sandbox.ts`, spread into `validation.ts:66`.
`apps/api/src/agent/registered-plugins.ts:183` uses `webPodOf({ jinaKey })` in place of `webPod`.
Without a key, `web_fetch` uses the direct fetch only and `web_search` answers one sentence.

## Build

1. `plugins/web/src/pod/search/`: `contract.ts` (the port), `jina.ts` (the adapter), `index.ts`.
   Delete `bing.ts`, `duckduckgo.ts`, `keyed.ts` and the backend map.
2. `plugins/web/src/pod/read/jina-reader.ts`: the reader adapter. `fetch-tool.ts` tries it first,
   then `fetchPage`. Map each Jina failure to one sentence. Never pass a raw body.
3. `webPodOf({ jinaKey })` in `plugins/web/src/pod/index.ts`.
4. Delete the control-plane search config end to end: `packages/plugin-sdk/src/slots.ts:65-67,113`,
   `packages/host/src/holder/pod-control.ts:40-42,166-171`,
   `apps/api/src/agent/control/web-search-config.ts`, `local-pod-control.ts:226-240`, the test rigs.
5. Delete the web settings UI for search (`apps/web/src/features/settings/pages/agent.tsx:95-115`,
   `agent-key-row.tsx`, `agent-keys.ts`, `settings-search.ts`) and the cloud setting
   `web.searchBackend` (`packages/core/src/settings/cloud/harness-settings.ts:146-151`).
6. v1 stays as it is (`packages/harness`, `apps/tui`, `packages/core/src/settings/registry.ts`).
7. Tests with a fake `fetch`: each Jina status, the 422 retry, the fallback, and the parameter →
   header mapping. README for `plugins/web` and `packages/plugin-sdk`.

## Live check (production)

A fresh probe session runs: a search ("Bun 1.4.5 release notes"), a JS-heavy page with `render`,
one PDF page with `page`, and a selector extract. Then the error rate one week after the merge,
from the same `V2Event` query.
