import { EAgentStart, type EventLogPort, type IdPort, type LogPort, type ThreadId } from '@dltech/atlas-core'

import { logFieldsOf } from '../../store/logs'
import { EClientRequest, readSessionArchiveReplySchema } from '../channel-wire'
import type { ThreadStorePort } from '../../store/thread-store'
import { claimSession } from '../../store/sessions/lock'
import { atlasDirectory } from '../../store/paths'
import { sessionDirectory, sessionLockFile } from '../../store/sessions/paths'
import { extractSessionArchive } from '../session-archive'
import type { CloudChannel } from './cloud-bridge'

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
 * parent's session directory. The one refusal: the cloud having nothing to give can only mean the
 * lift never landed, and overwriting would erase the local copy for nothing.
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
  await extractSessionArchive({ archive: Buffer.from(reply.archive, 'base64'), sessionDir })
  // The overwrite drops the session lock this process was holding, so it is laid down again — the
  // reopen that follows claims for real, and until then nothing else may open the transcript.
  await claimSession({ sessionDir, lockFile: sessionLockFile({ sessionDir }), label: 'atlas tui' })
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
