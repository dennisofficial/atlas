import { join } from 'node:path'

import { createDesktopHost } from '../host'
import { bunPath, startNextServer } from '../host/next-server'
import { defaultDesktopHome } from '../host/pods/config'
import type { IPanePort, PaneReply } from '../host/pane-routes'
import { SESSION_MARKER, sessionUrlOf } from './session-url'

const webRoot =
  process.env.ATLAS_WEB_ROOT ?? join(import.meta.dir, '../../../web-standalone/apps/web')
const secret = process.env.ATLAS_SECRET ?? crypto.randomUUID()
const paneOrigin = process.env.ATLAS_PANE_ORIGIN
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
const host = createDesktopHost({
  appOrigin: nextServer.origin,
  secret,
  app: { version: process.env.ATLAS_VERSION ?? '0.0.0', channel: 'stable', chromium: false },
  auth: { home: defaultDesktopHome(), openExternal: () => true },
  // The pane is a real browser, so every origin the web app asks about is allowed. The route exists
  // because the electrobun webview needed an allowlist; the shell keeps it answering 204 so the web
  // app's preview gate settles instead of failing.
  window: { titlebarDoubleClick: () => {}, setPreviewOrigins: () => {} },
  pane,
})
process.stdout.write(`${SESSION_MARKER}${sessionUrlOf({ origin: host.url, secret })}\n`)

const stop = async () => {
  await host.stop()
  await nextServer.stop()
}

process.on('SIGTERM', () => void stop())
process.on('SIGINT', () => void stop())
