# Browser returns

How a browser sign-in comes back to the surface that started it: web, Mac, iOS or the TUI. A client
opens the start link `/return/start/<state>?surface=` that a flow's begin call returns. The API
records the surface, sets a sealed cookie and redirects to the provider. The flow's callback asks the
framework where to return, and each surface reads the result at once. The pure contract
lives in `packages/core/src/browser-return`.

## TUI

The TUI opens the start link in the system browser with `surface=tui` and `port=<port>` added to it.
A `Bun.serve` listener on `127.0.0.1:0` waits for the browser to come back, as RFC 8252 §7.3
describes for a loopback redirect.
- The API redirects the browser to
  `http://127.0.0.1:<port>/atlas-return?atlasReturn=…&atlasState=…&atlasReason=…`.
- `loopbackReplyOf` accepts a request only when the method is GET, the peer address is loopback, the
  URL names `127.0.0.1` on the bound port, the path is `/atlas-return`, and `atlasState` equals the
  state the listener opened with. Any other request gets 404 and the listener keeps waiting.
- An accepted return answers with a small HTML page built from the flow's copy
  (`{ connected, failed(reason) }`, HTML-escaped), records the outcome in the shared return store
  (`browserReturns`), and stops the listener.
- The listener gives up after `LOOPBACK_TIMEOUT_MS` (10 minutes), or when another start link
  replaces it. The timer and the server are unref'd, so neither holds the process open.
- `openBrowserReturn` reuses the listener for the same state, replaces it for another state, and
  opens a plain URL (an older card or a raw provider URL) directly with no listener.
- `useReturnOutcome({ state, durable })` reads the durable outcome first, then the local one, and
  re-renders when the listener records a result.

Headless fallback: a flow that has a device code keeps it for SSH and other headless sessions. The
loopback needs a browser on the same machine, so the flow decides, not the framework.

## Clients

Web, Mac and iOS open the start link in a browser they do not control. The browser returns to a
page of the app, and the client reads the outcome from the return params.
- `openBrowserReturn({ url })` (`apps/web/src/features/auth/browser-return/open-browser-return.ts`)
  opens `startLinkFor({ surface })` in a window named `atlas-return-<state>`, with
  `noopener,noreferrer`. The surface is `web` in a browser and `desktop` on the Mac host
  (`isDesktopHost`). Mac sends every `window.open` to the system browser: `setWindowOpenHandler`
  in `apps/mac/main.js:76` answers with `denyWindow`, and `denyWindow` calls `shell.openExternal`.
- `BrowserReturnReader` is mounted once, in `apps/web/src/app/(private)/layout.tsx`, above the
  session gate. On each change of the search params it reads `browserReturnOf` of the page URL,
  remembers the outcome in `browserReturns`, posts it on the `atlas-return` broadcast channel,
  replaces the URL with `withoutReturnParams`, and closes the window when its name has the prefix.
  Every tab listens on the channel and remembers what it receives, so the tab that holds the card
  sees the outcome that the return window read.
- `useReturnOutcome({ state, durable })` returns the durable outcome when the caller has one, and
  otherwise the outcome this tab remembered for the state (`returnOutcomeOf`). It re-renders when
  the store changes.
- `browserReturns` and `createReturnStore()` come from `@dltech/atlas-client/browser-return`, so
  the store is the same for a flow in the app and the card that shows it.

iOS opens the start link with `WebBrowser.openAuthSessionAsync(startLink, 'atlas://')`. The API
returns the browser to `atlas://<path>?atlasReturn=…&atlasState=…`, which the system hands back to
the app, and the sheet closes on its own.
- `openBrowserReturn({ url })` (`apps/mobile/src/browser-return/open-browser-return.ts`) waits for
  the sheet, accepts the return only when `atlasState` equals `stateOfStartLink(startLink)`,
  remembers it in `browserReturns`, and resolves with the outcome. A dismissed sheet resolves with
  `undefined`.
- The web twin (`open-browser-return.web.ts`) opens the start link with `surface=web` through
  `openBrowserAsync` and resolves with `undefined`: the web reader of the app handles that return.

## Start a sign-in from a new iOS screen

Call the flow's begin API to get its start link, open it, and render from `useReturnOutcome`:

```tsx
const [link, setLink] = useState<string>()
const outcome = useReturnOutcome({ state: stateOfStartLink(link ?? ''), durable })

const handleSignIn = async () => {
  const started = await api.flow.begin() // { url: 'https://api.byatlas.io/return/start/<state>' }
  setLink(started.url)
  const returned = await openBrowserReturn({ url: started.url })
  if (returned !== undefined) await refresh() // or wait for the durable outcome
}
```

The card shows `outcome` while the screen is open, and the durable outcome after a reload. Do not
keep a second copy of the outcome per flow: the shared store holds it under the state.

## Login

Signing in to Atlas itself is a different contract from a flow's yes/no return: a bearer token is
only minted for a client that proves it holds the PKCE verifier. So every surface keeps its own
PKCE pair and calls `desktopAuth.exchange` with the code and the verifier; the framework carries
sign-in results for flows, not tokens.
- Web signs in in the page, with better-auth and a session cookie.
- Mac opens `https://byatlas.io/desktop/authorize?redirect_uri=http://127.0.0.1:<port>/desktop/auth/callback&state=&code_challenge=&code_challenge_method=S256`
  and receives the code on its host's loopback listener (`apps/mac/src/host/auth/auth-service.ts`).
- iOS opens `atlas://auth/callback` through `WebBrowser.openAuthSessionAsync` and the system hands
  the code back to the app (`apps/mobile/src/auth/sign-in-flow.ts`).
- The TUI runs the RFC 8252 loopback as well, on the `/desktop/auth/callback` path its listener
  serves (`startLoopbackWait` in `@dltech/atlas-client/loopback`). A terminal
  that cannot open a browser on its own machine uses the RFC 8628 device code instead:
  `loginFlowOf` chooses the device code over SSH (`SSH_CONNECTION`, `SSH_TTY`) or on Linux with no
  `DISPLAY` and no `WAYLAND_DISPLAY`. The listener gives up, or fails to bind, and the flow falls
  back to the device code on its own. While the browser is open the waiting screen keeps the
  device code one keypress away, so a session that looks local still has a way through.

## Flows on the framework

| Flow  | Start                                                 | Return path                                                                                            | Durable result                        |
| ----- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `mcp` | the MCP transcript card's sign-in, or a settings page | `/sessions/<id>`, `/settings/integrations`, `/projects/<id>/settings/mcp`, `/groups/<id>/settings/mcp` | the roster row, read by the next turn |

The MCP transcript card signs in an `http` MCP server. The agent tool `operator_mcp_sign_in` begins
the flow, and the callback answers a session screen through `BrowserReturnService.answer`, so the
card on web, Mac, iOS or the TUI shows the outcome at once. Every screen answers through the
framework, including the user, project and group MCP settings pages, and a state the framework does
not know falls back to `/settings/integrations`. The API also keeps a refused sign-in on the server
row, so the roster reads `failed` with the provider's reason and the card resolves failed even after
a reload. The web settings page reads the outcome from the shared return store, and the flow no
longer carries a `mcpOauth` result param of its own.

## API

A flow keeps its own pending data, meaning the PKCE verifier, the code and whatever else the
provider needs. The framework holds only the way back. `BrowserReturnService` lives in
`apps/api/src/agent/browser-return` and comes out of `apps/api/src/agent/index.ts`. It is built with
`{db, cipher, publicUrl, webOrigin}`.
1. `begin({flow, state, userId?, providerUrl, callbackPath, webPath, ttlMs?})` seals the provider URL
   into the `BrowserReturnPending` row and answers `{startUrl, expiresAt}`. Hand the user the start
   link, not the provider URL: the start link is what records the surface and the TUI port.
2. `start({state, surface, port})` answers `{kind: 'redirect', location, cookie}` for an open state,
   or `{kind: 'gone', html}` for an unknown or expired one. `BrowserReturnController` serves it at
   `GET /return/start/:state` with `cache-control: no-store`.
3. `answer({state, cookieHeader, outcome, fallbackWebPath})` runs in the flow's own callback, after
   its own exchange. It answers `{kind: 'redirect', location, clearCookie}` or
   `{kind: 'page', html, clearCookie}` and takes the row once. Send `clearCookie` with the answer.

```ts
const begun = await returns.begin({
  flow: 'mcp',
  state,
  providerUrl,
  callbackPath: '/mcp-oauth/callback',
  webPath: '/settings/integrations',
})
const answer = await returns.answer({
  state,
  cookieHeader: request.headers.cookie,
  outcome: { result: EReturnResult.Connected },
  fallbackWebPath: '/settings/integrations',
})
```

## Provider subscriptions (Claude, ChatGPT)

The provider clients Atlas borrows accept only loopback redirects, so no Atlas callback can receive
their code. The TUI and Mac host bind the loopback the provider allows (ChatGPT
`127.0.0.1:1455`, then `1457`; Claude `localhost:<free port>`), start the attempt with
`providerSignIn.begin({ flow: 'loopback', redirectUri })`, and finish it with
`providerSignIn.complete`. The Bun-only `@dltech/atlas-client/loopback` entry point owns the
listener and provider return validation, so both clients use the same checks and cancellation.
Over SSH or with no display the TUI keeps paste (Claude) and the device code (ChatGPT).
Web and iOS keep those flows.

The Mac web payload starts the guarded `POST /desktop/provider-sign-in/start { provider }`
route. The host binds first, calls begin with its bearer, opens the system browser and returns
`{ attemptId }`. It receives and exchanges the code itself; no authorization code crosses into the
web payload. `GET /desktop/provider-sign-in/status?attempt=<id>` reads the host's in-memory
`pending`, `signed-in`, `failed` or `cancelled` outcome. The payload polls this **local host**
every two seconds, not the network API, and refreshes its account list on `signed-in`.
`POST /desktop/provider-sign-in/stop { attemptId }` closes the listener on cancel or unmount.
Sign-out and host shutdown also cancel active attempts.

This needs the new Mac host build and the next web deploy. An old host answers 404 on start;
a host that cannot bind, begin or open the browser answers 409 or 502 with a fallback reason.
The web payload falls back to paste (Claude) or device code (ChatGPT) in those cases.
Merging to main triggers `.github/workflows/ci.yml`'s `mac-release` job for this host change;
there is no manual release step.
