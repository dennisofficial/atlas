import type { ThreadId } from '@dltech/atlas-core'

import { buildSessionArchive } from '@dltech/atlas-harness'
import { atlasDirectory } from '@dltech/atlas-harness'
import { sessionDirectory } from '@dltech/atlas-harness'

/**
 * The descend's transcript transfer: the whole session directory the sandbox served from, tarred
 * the way the lift shipped it up. An empty directory answers null — the descend reads that as the
 * cloud holding nothing and refuses rather than wiping the local copy.
 */
export async function serveSessionArchive(args: {
  threadId: ThreadId
}): Promise<Uint8Array | null> {
  const archive = await buildSessionArchive({
    sessionDir: sessionDirectory({ home: atlasDirectory(), sessionId: args.threadId }),
  })
  return archive === undefined ? null : archive
}
