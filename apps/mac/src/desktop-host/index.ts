import { join } from 'node:path'

import { createDesktopHost } from '../host'
import { bunPath, startNextServer } from '../host/next-server'
import { defaultDesktopHome } from '../host/pods/config'
import { SESSION_MARKER, sessionUrlOf } from './session-url'

const webRoot =
  process.env.ATLAS_WEB_ROOT ?? join(import.meta.dir, '../../../web-standalone/apps/web')
const secret = process.env.ATLAS_SECRET ?? crypto.randomUUID()
const nextServer = await startNextServer({ root: webRoot, bunPath: bunPath() })
const host = createDesktopHost({
  appOrigin: nextServer.origin,
  secret,
  app: { version: process.env.ATLAS_VERSION ?? '0.0.0', channel: 'stable', chromium: false },
  auth: { home: defaultDesktopHome(), openExternal: () => true },
})
process.stdout.write(`${SESSION_MARKER}${sessionUrlOf({ origin: host.url, secret })}\n`)

const stop = async () => {
  await host.stop()
  await nextServer.stop()
}

process.on('SIGTERM', () => void stop())
process.on('SIGINT', () => void stop())
