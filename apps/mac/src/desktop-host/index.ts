import { join } from 'node:path'

import { createDesktopHost } from '../host'
import { createLoginShellPath } from '../host/mac-mcp/login-path'
import { createMacMcpRunner, type MacMcpRunner } from '../host/mac-mcp/runner'
import { bunPath, startNextServer } from '../host/next-server'
import { defaultDesktopHome } from '../host/desktop-home'
import type { IPanePort, PaneReply } from '../host/pane-routes'
import { createUpdatesPort, UPDATE_ORIGIN_ENV } from '../host/updates-port'
import { CERT_MARKER, HTTP_ORIGIN_MARKER, SESSION_MARKER, sessionUrlOf } from './session-url'

const webRoot =
  process.env.ATLAS_WEB_ROOT ?? join(import.meta.dir, '../../../web-standalone/apps/web')
const secret = process.env.ATLAS_SECRET ?? crypto.randomUUID()
const paneOrigin = process.env.ATLAS_PANE_ORIGIN
const updateOrigin = process.env[UPDATE_ORIGIN_ENV]
const pane: IPanePort | undefined =
  paneOrigin === undefined
    ? undefined
    : {
        send: async (command) => {
          const reply = await fetch(`${paneOrigin}/pane`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(command),
          })
          return (await reply.json()) as PaneReply
        },
      }
const nextServer = await startNextServer({ root: webRoot, bunPath: bunPath() })
const login = createLoginShellPath({ spawn: Bun.spawn })
let runner: MacMcpRunner | undefined
const host = await createDesktopHost({
  appOrigin: nextServer.origin,
  stablePortHome: defaultDesktopHome(),
  secret,
  app: { version: process.env.ATLAS_VERSION ?? '0.0.0', channel: 'stable', chromium: false },
  auth: { home: defaultDesktopHome(), openExternal: () => true },
  openExternal: async (url) => {
    const browser = Bun.spawn(['/usr/bin/open', url], { stdout: 'ignore', stderr: 'ignore' })
    return (await browser.exited) === 0
  },
  // The pane is a real browser, so every origin the web app asks about is allowed. The route exists
  // because the electrobun webview needed an allowlist; the shell keeps it answering 204 so the web
  // app's preview gate settles instead of failing.
  window: { titlebarDoubleClick: () => {}, setPreviewOrigins: () => {} },
  pane,
  updates: updateOrigin === undefined ? undefined : createUpdatesPort({ origin: updateOrigin }),
  macMcp: (emit) => {
    runner = createMacMcpRunner({
      emit,
      spawn: Bun.spawn,
      path: login.path,
      log: (line) => process.stderr.write(`[mcp] ${line}\n`),
    })
    return runner
  },
})
process.stdout.write(`${SESSION_MARKER}${sessionUrlOf({ origin: host.secureUrl, secret })}\n`)
process.stdout.write(`${HTTP_ORIGIN_MARKER}${host.url}\n`)
process.stdout.write(`${CERT_MARKER}${host.certFingerprint}\n`)

const stop = async () => {
  runner?.stop()
  await host.stop()
  await nextServer.stop()
}

process.on('SIGTERM', () => void stop())
process.on('SIGINT', () => void stop())
