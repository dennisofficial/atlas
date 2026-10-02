import type { PlacementRecord, ThreadId, WorkspaceIdentity } from '@dltech/atlas-core'

import { EClientRequest, readMemoryArchiveReplySchema, readSessionArchiveReplySchema } from '../channel-wire'
import { claimSession } from '../../store/sessions/lock'
import { atlasDirectory } from '../../store/paths'
import { sessionDirectory, sessionLockFile } from '../../store/sessions/paths'
import type { CloudChannel } from './cloud-bridge'
import { replaceSessionDirectoryGuarded } from './descend-preserve'
import { mergeMemoryArchive } from './session-archive'

export async function transferTranscriptDown(args: {
  threadId: ThreadId
  channel: CloudChannel
  preserveOwnership?: { record: PlacementRecord; workspace: WorkspaceIdentity } | undefined
}): Promise<void> {
  const reply = readSessionArchiveReplySchema.parse(
    await args.channel.request({ op: EClientRequest.ReadSessionArchive, params: {} }),
  )
  if (reply.archive.length === 0) {
    throw new Error(
      'the cloud holds no transcript for this conversation — refusing to wipe the local copy',
    )
  }
  const sessionDir = sessionDirectory({ home: atlasDirectory(), sessionId: args.threadId })
  await replaceSessionDirectoryGuarded({
    archive: Buffer.from(reply.archive, 'base64'),
    sessionDir,
    threadId: args.threadId,
    preserveOwnership: args.preserveOwnership,
  })
  await claimSession({ sessionDir, lockFile: sessionLockFile({ sessionDir }), label: 'atlas tui' })
}

export async function transferMemoryDown(args: {
  channel: CloudChannel
  repoRoot: string
}): Promise<void> {
  const reply = await args.channel
    .request({ op: EClientRequest.ReadMemoryArchive, params: {} })
    .then((result) => readMemoryArchiveReplySchema.parse(result))
    .catch(() => ({ archive: '' }))
  if (reply.archive.length === 0) return

  await mergeMemoryArchive({
    archive: Buffer.from(reply.archive, 'base64'),
    atlasHome: atlasDirectory(),
    repoRoot: args.repoRoot,
  })
}

export const awaitPause = (args: { channel: CloudChannel; deadlineMs: number }): Promise<boolean> =>
  new Promise((resolve) => {
    const unsubscribe = args.channel.onTurnEnded((outcome) => {
      if (outcome.status !== 'relocation-paused') return
      clearTimeout(timer)
      unsubscribe()
      resolve(true)
    })
    const timer = setTimeout(() => {
      unsubscribe()
      resolve(false)
    }, args.deadlineMs)
  })
