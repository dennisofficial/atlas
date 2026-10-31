import type { ThreadId } from '@dltech/atlas-core'
import { readSessionTitleEvents, sessionDigest, type ThreadStorePort } from '@dltech/atlas-harness'

import type { AtlasApp } from './compose'

export const titleDigestReader =
  (args: {
    app: Pick<AtlasApp, 'threads' | 'log'>
    threads?: ThreadStorePort | undefined
    threadId: ThreadId
  }): (() => Promise<string>) =>
  async () =>
    sessionDigest(
      await readSessionTitleEvents({
        threads: args.threads ?? args.app.threads,
        log: args.app.log,
        threadId: args.threadId,
      }),
    )
