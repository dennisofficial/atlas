import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { LogPort, PlacementRecord, ThreadId, WorkspaceIdentity } from '@dltech/atlas-core'
import { logFieldsOf } from '../../store/logs'

import { EClientRequest, readMemoryArchiveReplySchema, readSessionArchiveReplySchema } from '../channel-wire'
import { claimSession } from '../../store/sessions/lock'
import { atlasDirectory } from '../../store/paths'
import { sessionDirectory, sessionLockFile } from '../../store/sessions/paths'
import type { CloudBridge, CloudChannel } from './cloud-bridge'
import { exportedSessionPathOf } from '../session-archive-transport'
import { replaceSessionDirectoryGuarded } from './descend-preserve'
import { mergeMemoryArchive } from './session-archive'
import type { TransferProgress } from '../transfer-progress'

export async function transferTranscriptDown(args: {
  threadId: ThreadId
  channel: CloudChannel
  bridge: CloudBridge
  logPort?: LogPort | undefined
  preserveOwnership?: { record: PlacementRecord; workspace: WorkspaceIdentity } | undefined
  onProgress?: ((progress: TransferProgress) => void) | undefined
}): Promise<void> {
  const download = args.bridge.sandboxes.downloadSession
  if (download === undefined) throw new Error('the cloud bridge cannot download a session archive; the session remains in the cloud')
  const reply = readSessionArchiveReplySchema.parse(
    await args.channel.request({ op: EClientRequest.ReadSessionArchive, params: {} }),
  )
  if (reply.archive === null) {
    throw new Error(
      'the cloud holds no transcript for this conversation — refusing to wipe the local copy',
    )
  }
  if (reply.archive.threadId !== args.threadId) throw new Error('the session archive export names a different root')
  exportedSessionPathOf({ path: reply.archive.path, threadId: args.threadId })
  const directory = await mkdtemp(join(tmpdir(), 'atlas-descend-transcript-'))
  const archivePath = join(directory, 'session.tar.gz')
  const sessionDir = sessionDirectory({ home: atlasDirectory(), sessionId: args.threadId })
  try {
    await download({ threadId: args.threadId, archive: reply.archive, destination: archivePath, onProgress: args.onProgress })
    await replaceSessionDirectoryGuarded({
      archivePath,
      sessionDir,
      threadId: args.threadId,
      preserveOwnership: args.preserveOwnership,
    })
    await claimSession({ sessionDir, lockFile: sessionLockFile({ sessionDir }), label: 'atlas tui' })
  } finally {
    await args.bridge.sandboxes.releaseSession?.({ threadId: args.threadId, path: reply.archive.path }).catch((error: unknown) => {
      args.logPort?.warn({ source: 'cloud.descend', threadId: args.threadId, message: 'the session export could not be removed from the sandbox', ...logFieldsOf({ error }) })
    })
    await rm(directory, { recursive: true, force: true })
  }
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
