import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Event, ThreadId } from '@dltech/atlas-core'
import {
  atlasDirectory,
  EClientRequest,
  eventLogFile,
  extractSessionArchive,
  newThreadMeta,
  parseEventLines,
  readMetaSync,
  readSessionArchiveReplySchema,
  registryFor,
  sessionMetaFile,
  sessionMetaSchema,
  threadMetaFile,
  threadMetaSchema,
  writeMeta,
  type CloudChannel,
  type CloudSandboxes,
  type ThreadMeta,
} from '@dltech/atlas-harness'
import { EExecutionLocation } from '@dltech/atlas-core'
import type { SessionArchiveDescriptor } from '@dltech/atlas-wire'

import { localTranscriptFiles } from './local-transcript-files'

export type RotationMirror = {
  revert(): Promise<void>
  seal(): Promise<void>
  /** The successor's events as mirrored, so the caller can build the conversation without a wire read. */
  successorEvents: readonly Event[]
  /** The successor's thread row as mirrored, so the caller can build the conversation without a wire read. */
  successorThread: ThreadMeta | undefined
}

const readThreadEvents = async (args: {
  sessionDir: string
  threadId: ThreadId
}): Promise<Event[]> => {
  const file = eventLogFile({ sessionDir: args.sessionDir, threadId: args.threadId })
  const text = await Bun.file(file).text().catch(() => null)
  if (text === null) return []
  return parseEventLines({ text, threadId: args.threadId }).events
}

const readThreadMeta = (args: { sessionDir: string; threadId: ThreadId }): ThreadMeta | undefined =>
  readMetaSync({
    file: threadMetaFile({ sessionDir: args.sessionDir, threadId: args.threadId }),
    schema: threadMetaSchema,
  })

/**
 * The swap writes bytes the log port does not know about, so the session's local bookkeeping is
 * stamped to match: both threads register as cloud-owned in the session's directory (the
 * successor's meta may not exist locally at all), and the session meta points its active main at
 * the successor — the record `useRotation`'s committed-rotation recovery reads on the next open.
 */
const stampSessionOwnership = async (args: {
  extracted: string
  home: string
  successor: ThreadId
  predecessor: ThreadId
}): Promise<void> => {
  const { extracted, home, successor, predecessor } = args
  const registry = registryFor({ home })
  const sessionDir = await registry.sessionDirFor({ threadId: predecessor })
  const handle = registry.handleFor({ sessionDir })
  await registry.enqueue({
    handle,
    run: async () => {
      const now = new Date().toISOString()
      for (const threadId of [successor, predecessor]) {
        const incoming = readThreadMeta({ sessionDir: extracted, threadId })
        const file = threadMetaFile({ sessionDir, threadId })
        const meta: ThreadMeta = {
          ...(incoming ??
            readThreadMeta({ sessionDir, threadId }) ??
            newThreadMeta({ id: threadId, at: now })),
          executionLocation: EExecutionLocation.Cloud,
          updatedAt: now,
        }
        await writeMeta({ file, meta })
        registry.registerThread({ sessionDir, threadId })
      }

      const sessionFile = sessionMetaFile({ sessionDir })
      const sessionMeta = readMetaSync({ file: sessionFile, schema: sessionMetaSchema })
      if (sessionMeta !== undefined) {
        await writeMeta({
          file: sessionFile,
          meta: { ...sessionMeta, activeMainThreadId: successor, updatedAt: now },
        })
      }
      registry.invalidateSession({ sessionDir })
    },
  })
}

/**
 * A committed cloud rotation moves the session's transcript ownership from the predecessor to the
 * successor inside the sandbox. The local log is the attach-time source of truth — the next
 * attach's Hello reports its head and the serve vouches against it — so the commit has to land
 * here before any new attachment is adopted: the whole session directory is pulled down through
 * the same export the descend uses, and the two thread transcripts are swapped into the local
 * files. The successor's swap is what the fresh attach's Hello vouches against; the predecessor's
 * keeps a later descend of the predecessor reading the same bytes the sandbox holds.
 *
 * The swap is revertable until `seal`: adopting the new binding is the commit point, and a
 * failure before it puts the original bytes back.
 */
export async function mirrorRotationCommit(args: {
  channel: CloudChannel
  sandboxes: Pick<CloudSandboxes, 'downloadSession' | 'releaseSession'>
  successor: ThreadId
  predecessor: ThreadId
  localLog: { refresh(args: { threadId: ThreadId }): Promise<void> }
}): Promise<RotationMirror> {
  const { successor, predecessor, channel, sandboxes, localLog } = args
  const download = sandboxes.downloadSession
  if (download === undefined) {
    throw new Error('the cloud bridge cannot download a session archive for the rotation mirror')
  }
  const reply = readSessionArchiveReplySchema.parse(
    await channel.request({ op: EClientRequest.ReadSessionArchive, params: {} }),
  )
  if (reply.archive === null) {
    throw new Error('the sandbox exported no session archive for the rotation mirror')
  }
  const descriptor: SessionArchiveDescriptor = reply.archive

  const staging = await mkdtemp(join(tmpdir(), 'atlas-rotation-mirror-'))
  const archivePath = join(staging, 'session.tar.gz')
  const extracted = join(staging, 'session')

  try {
    // The sandbox's name is a digest of the thread that owns it — the predecessor the lift
    // created it for, not the successor the rotation just minted. The session archive roots at
    // the same session id (the predecessor), so both the sandbox lookup and the descriptor's
    // own root check address the predecessor; the successor's transcript rides inside it.
    await download({ threadId: predecessor, archive: descriptor, destination: archivePath })
    await extractSessionArchive({ archivePath, sessionDir: extracted })

    const successorEvents = await readThreadEvents({ sessionDir: extracted, threadId: successor })
    if (successorEvents.length === 0) {
      throw new Error('the rotated successor transcript was not in the sandbox session archive')
    }
    const successorThread = readThreadMeta({ sessionDir: extracted, threadId: successor })
    const predecessorEvents = await readThreadEvents({ sessionDir: extracted, threadId: predecessor })

    await stampSessionOwnership({ extracted, home: atlasDirectory(), successor, predecessor })

    const files = localTranscriptFiles({ home: atlasDirectory })
    const successorSwap = await files.swap({ threadId: successor, events: successorEvents })
    const predecessorSwap =
      predecessorEvents.length === 0
        ? undefined
        : await files.swap({ threadId: predecessor, events: predecessorEvents })

    // The log port caches each thread's read, so the swapped bytes are invisible until a refresh —
    // and the caller's next step (opening the successor) reads through that cache. Refresh the
    // moment the files land, not at seal: a stale read between swap and seal opens the successor
    // as empty and the open falls into the eager wake path, which boots a fresh successor-named
    // sandbox with no transcript at all.
    const refreshBoth = async (): Promise<void> => {
      await localLog.refresh({ threadId: successor })
      await localLog.refresh({ threadId: predecessor })
    }
    await refreshBoth()

    return {
      successorEvents,
      successorThread,
      revert: async () => {
        await successorSwap.revert().catch(() => undefined)
        await predecessorSwap?.revert().catch(() => undefined)
        await refreshBoth().catch(() => undefined)
        await rm(staging, { recursive: true, force: true }).catch(() => undefined)
      },
      seal: async () => {
        await successorSwap.seal()
        await predecessorSwap?.seal()
        await rm(staging, { recursive: true, force: true }).catch(() => undefined)
      },
    }
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}
