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
- `openBrowserReturn({ url })` (`apps/web/src/features/browser-return/open-browser-return.ts`)
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
