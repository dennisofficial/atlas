import type { LogPort } from '@dltech/atlas-core'
import { SessionsClient, uploadLocalMirrors } from '@dltech/atlas-harness'

import { clientVersionHeader } from '../../build/info'

export type MirrorUploadApp = {
  pods: boolean
  cloud: { session(): { url: string; token: string } | null }
}

export function startMirrorUpload(args: {
  app: MirrorUploadApp
  home: string
  log: LogPort | null
  fetchFn?: typeof fetch | undefined
}): Promise<void> {
  const session = args.app.cloud.session()
  if (!args.app.pods || session === null || args.log === null) return Promise.resolve()
  const client = new SessionsClient({
    url: session.url,
    token: session.token,
    clientVersion: clientVersionHeader(),
    ...(args.fetchFn === undefined ? {} : { fetchFn: args.fetchFn }),
  })
  return uploadLocalMirrors({ home: args.home, client, log: args.log }).catch(() => undefined)
}
