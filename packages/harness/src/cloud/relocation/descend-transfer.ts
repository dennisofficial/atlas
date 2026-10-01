import { EAgentStart, type EventLogPort, type IdPort, type LogPort, type ThreadId } from '@dltech/atlas-core'

import { logFieldsOf } from '../../store/logs'
import { EClientRequest, readMemoryArchiveReplySchema, readSessionArchiveReplySchema } from '../channel-wire'
import type { ThreadStorePort } from '../../store/thread-store'
import { claimSession } from '../../store/sessions/lock'
import { atlasDirectory } from '../../store/paths'
import { sessionDirectory, sessionLockFile } from '../../store/sessions/paths'
import type { CloudChannel } from './cloud-bridge'
import { replaceSessionDirectoryGuarded } from './descend-preserve'
import { mergeMemoryArchive } from './session-archive'

/**
 * The archive rebuilt the family's rows on the local store; the roster needs each child
 * re-announced on the parent's log so it can rebuild after the move home.
 */
export async function reannounceChildren(args: {
  threadId: ThreadId
  threads: ThreadStorePort
  log: EventLogPort
  ids: IdPort
  logPort?: LogPort | undefined
}): Promise<void> {
  const children = await args.threads.spawned({ threadId: args.threadId })
  for (const child of children) {
    if (child.agent === undefined) continue
    await args.log
      .append({
        threadId: args.threadId,
        runId: args.ids.nextRunId(),
        drafts: [
          {
            type: 'agent-spawned',
            agentId: child.id,
            agentType: child.agent.type,
            intent: child.title ?? '',
            mode: EAgentStart.Fresh,
          },
        ],
      })
      .catch((error: unknown) => {
        args.logPort?.warn({
          source: 'cloud.descend',
          message: 'a child could not be re-announced on the descended log',
          threadId: args.threadId,
          data: { operation: 'reannounce-child', childId: child.id },
          ...logFieldsOf({ error }),
        })
      })
  }
}

/**
 * The cloud is the transcript's home while the conversation is away, so coming home is the session
 * directory moving back: the serve tars it, the channel carries it, and the local atlas home is
 * overwritten with it wholesale. Children come along in the same archive — the family shares the
 * parent's session directory. Two refusals: the cloud having nothing to give can only mean the
 * lift never landed, and an archive whose root holds no conversation where the local root does is
 * a capabilities-only boot directory, not a transcript — overwriting would erase the local copy
 * for nothing either way.
 */
export async function transferTranscriptDown(args: {
  threadId: ThreadId
  channel: CloudChannel
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
  })
  // The overwrite drops the session lock this process was holding, so it is laid down again — the
  // reopen that follows claims for real, and until then nothing else may open the transcript.
  await claimSession({ sessionDir, lockFile: sessionLockFile({ sessionDir }), label: 'atlas tui' })
}

/**
 * What the sandbox wrote into memory comes home the same way the transcript does: over the
 * channel, in the same per-descend archive shape the lift carried it up in, never a standing
 * store. An absent or refused answer means the sandbox holds no memory (or is too old to know the
 * op) — nothing to merge, not a failure of the descend. The merge itself is last-writer-wins per
 * file, so a redrive of the whole descend re-lands the same bytes harmlessly.
 */
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
