import type { ThreadId } from '@dltech/atlas-core'
import {
  transcriptIdentityDigest,
  type ParkedTranscriptRecord,
  type RuntimeCheckpoint,
  type ThreadStorePort,
} from '@dltech/atlas-harness'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../../ui/notice-store'
import { messageOf } from '../error-text'
import type { ThreadIdentity } from '../thread-reads'
import type { CloudAppliedSnapshot } from './cloud-readiness'
import type { TranscriptFiles } from './local-transcript-files'

export const PARK_PERSIST_NOTICE_KEY = 'park-persist-failed'

const DEFAULT_APPLIED_WAIT_MS = 5_000

const sameAs = (args: { left: ThreadIdentity; right: ThreadIdentity }): boolean =>
  args.left.head === args.right.head &&
  args.left.count === args.right.count &&
  args.left.digest === args.right.digest

const identityOfEvents = (events: Parameters<typeof transcriptIdentityDigest>[0]): ThreadIdentity => ({
  head: events.at(-1)?.seq ?? 0,
  count: events.length,
  digest: transcriptIdentityDigest(events),
})

export type ParkPersistence = {
  persist(checkpoint: RuntimeCheckpoint): Promise<void>
}

/**
 * The local transcript is only a faithful copy of the sandbox's if this client saw the session park
 * with the whole applied view in hand. At the park checkpoint the applied events replace the local
 * events file verbatim, the file is read back, and only a digest equal to the checkpoint's earns the
 * record its `applied` identity; any shortfall persists the record without it, so the next open
 * resumes Behind instead of trusting a copy that is not whole. Best-effort: a failure here warns and
 * never reaches the session.
 */
export function createParkPersistence(args: {
  threadId: ThreadId
  threads: Pick<ThreadStorePort, 'writeParkedTranscript'>
  files: TranscriptFiles
  applied: () => CloudAppliedSnapshot | null
  waitUntilApplied: (identity: ThreadIdentity) => Promise<void>
  refreshLog: () => Promise<void>
  readLog: () => Promise<Parameters<typeof transcriptIdentityDigest>[0]>
  /** Re-registers the sealed applied view so the dim authority reads the tail that parked the session; absent in fakes that never render. */
  seal?: ((snapshot: CloudAppliedSnapshot) => void) | undefined
  /** A lifted session's mirror: awaited before the swap so the record is written over a file the checkpoint has provably reached. A non-mirrored log has nothing to converge. */
  converge?: (() => Promise<void>) | undefined
  refreshApplied?: (() => Promise<void>) | undefined
  appliedWaitMs?: number | undefined
}): ParkPersistence {
  let chain: Promise<void> = Promise.resolve()

  const write = (record: ParkedTranscriptRecord): Promise<void> =>
    args.threads.writeParkedTranscript({ threadId: args.threadId, record })

  const settledApplied = async (checkpoint: RuntimeCheckpoint): Promise<CloudAppliedSnapshot | null> => {
    const wanted = checkpoint.transcript
    const held = args.applied()
    if (held !== null && sameAs({ left: held.identity, right: wanted })) return held

    const waitMs = args.appliedWaitMs ?? DEFAULT_APPLIED_WAIT_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    const arrived = await Promise.race([
      args.waitUntilApplied(wanted).then(() => true, () => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), waitMs)
        timer.unref?.()
      }),
    ])
    clearTimeout(timer)
    return arrived ? args.applied() : null
  }

  const snapshotMatching = async (checkpoint: RuntimeCheckpoint): Promise<ParkedTranscriptRecord['applied']> => {
    const applied = await settledApplied(checkpoint)
    const events = applied?.events
    if (applied === null || events === undefined) return null
    if (!sameAs({ left: applied.identity, right: checkpoint.transcript })) return null
    if (!sameAs({ left: identityOfEvents(events), right: checkpoint.transcript })) return null

    const swap = await args.files.swap({ threadId: args.threadId, events })
    await args.refreshLog()
    const readBack = identityOfEvents(await args.readLog())
    if (!sameAs({ left: readBack, right: checkpoint.transcript })) {
      await swap.revert()
      await args.refreshLog()
      return null
    }
    await swap.seal()
    args.seal?.(applied)
    return { head: readBack.head, count: readBack.count, digest: readBack.digest }
  }

  const run = async (checkpoint: RuntimeCheckpoint): Promise<void> => {
    await args.converge?.()
    await args.refreshApplied?.().catch(() => undefined)
    const applied = await snapshotMatching(checkpoint).catch((error: unknown) => {
      notify({
        key: PARK_PERSIST_NOTICE_KEY,
        text: `the transcript could not be saved for an instant resume — ${messageOf(error)}`,
        tone: ENoticeTone.Warn,
        ttlMs: NOTICE_WARN_MS,
      })
      return null
    })
    await write({ checkpoint, applied })
  }

  return {
    persist(checkpoint) {
      chain = chain.then(() => run(checkpoint)).catch((error: unknown) => {
        notify({
          key: PARK_PERSIST_NOTICE_KEY,
          text: `the park record could not be saved — ${messageOf(error)}`,
          tone: ENoticeTone.Warn,
          ttlMs: NOTICE_WARN_MS,
        })
      })
      return chain
    },
  }
}
