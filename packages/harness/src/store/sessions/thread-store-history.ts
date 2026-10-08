import { ECompactionAnchor, EForkMode, SURVIVES_SUMMARY, stampEvent, type ThreadId } from '@dltech/atlas-core'

import { ensureFamilyOwnership } from '../../workspace/family-ownership'
import { ForkSeqOutOfRange, ForkSourceMissing } from '../fork'
import type { ThreadSummary } from '../thread-store'
import { dropRewoundChildren, toThreadSummary, touchThreadMeta, tryReadThreadMeta } from './listing'
import { writeMeta, type ThreadMeta } from './meta'
import { sessionDirectory, threadMetaFile } from './paths'
import { writeSessionMetaForRoot } from './session-meta'
import type { ForkArgs, MarkArgs, RewindArgs, ThreadStoreContext } from './thread-store-context'
import { blankMeta, homeOf, sessionDirFor } from './thread-store-fields'
import { appendStampedEvent, rewriteThreadLog } from './thread-places'

export async function rewindThread({ context, args }: { context: ThreadStoreContext; args: RewindArgs }): Promise<void> {
  const { registry, ids, home, clock } = context
  const { threadId, toSeq, cutAgents = [] } = args
  const sessionDir = await sessionDirFor({ context, threadId })
  const handle = registry.handleFor({ sessionDir })
  await registry.enqueue({
    handle,
    run: async () => {
      await ensureFamilyOwnership({ sessionDir, registry })
      const log = await registry.readThreadLog({ sessionDir, threadId })
      await rewriteThreadLog({
        registry,
        ids,
        sessionDir,
        threadId,
        events: log.events.filter((event) => event.seq <= toSeq),
      })
      await dropRewoundChildren({ home, registry, agentIds: cutAgents })
      await touchThreadMeta({ registry, sessionDir, threadId, at: clock.now() })
    },
  })
}

export async function markThreadHistory({
  context,
  args,
}: {
  context: ThreadStoreContext
  args: MarkArgs & { discardRows: boolean; cutAgents: readonly ThreadId[] }
}): Promise<number> {
  const { registry, ids, home, clock } = context
  const { threadId, anchor, fromSeq, throughSeq, summary, discardRows, cutAgents } = args
  const sessionDir = await sessionDirFor({ context, threadId })
  const handle = registry.handleFor({ sessionDir })
  return registry.enqueue({
    handle,
    run: async () => {
      const at = clock.now()
      if (discardRows) await ensureFamilyOwnership({ sessionDir, registry })
      const log = await registry.readThreadLog({ sessionDir, threadId })
      const vacated = log.events
        .filter(
          (event) =>
            event.seq >= fromSeq &&
            event.seq <= throughSeq &&
            !SURVIVES_SUMMARY.includes(event.type) &&
            !(event.type === 'tool-result' && (event.qualityReviews ?? []).length > 0),
        )
        .map((event) => event.seq)
      const standIn = discardRows
        ? anchor === ECompactionAnchor.Prefix
          ? vacated.at(-1)
          : vacated[0]
        : undefined
      const watermark = stampEvent({
        draft: { type: 'history-compacted', anchor, fromSeq, throughSeq, summary, replaced: vacated.length },
        envelope: { id: ids.nextEventId(), seq: standIn ?? log.head + 1, threadId, runId: ids.nextRunId(), depth: 0, at },
      })
      if (!discardRows) {
        await appendStampedEvent({ registry, sessionDir, event: watermark })
      } else {
        const removed = new Set(vacated)
        const merged = [...log.events.filter((event) => !removed.has(event.seq)), watermark].sort((a, b) => a.seq - b.seq)
        await rewriteThreadLog({ registry, ids, sessionDir, threadId, events: merged })
        await dropRewoundChildren({ home, registry, agentIds: cutAgents })
      }
      await touchThreadMeta({ registry, sessionDir, threadId, at })
      return vacated.length
    },
  })
}

export async function forkThread({ context, args }: { context: ThreadStoreContext; args: ForkArgs }): Promise<ThreadSummary> {
  const { registry, ids, home, clock, log: eventLog } = context
  const { from, seq, mode, title } = args
  const fromDir = await sessionDirFor({ context, threadId: from })
  const handle = registry.handleFor({ sessionDir: fromDir })
  const created = await registry.enqueue({
    handle,
    run: async () => {
      const source = tryReadThreadMeta({ file: threadMetaFile({ sessionDir: fromDir, threadId: from }) })
      if (source === undefined) throw new ForkSourceMissing({ from })
      const head = (await registry.readThreadLog({ sessionDir: fromDir, threadId: from })).head
      if (seq < 0 || seq > head) throw new ForkSeqOutOfRange({ from, seq, head })
      const into = ids.nextThreadId()
      const sessionDir = sessionDirectory({ home, sessionId: into })
      const meta: ThreadMeta = {
        ...blankMeta({ clock, threadId: into, fields: { title, repo: source.repo } }),
        head: seq,
        parentThreadId: from,
        forkSeq: seq,
        forkMode: mode,
        workspace: source.workspace,
        modelRef: source.modelRef,
        modelEffort: source.modelEffort,
        executionLocation: source.executionLocation,
      }
      if (mode === EForkMode.Copy) {
        const prefix = await eventLog.read({ threadId: from, upTo: seq })
        await rewriteThreadLog({ registry, ids, sessionDir, threadId: into, events: prefix })
        meta.head = prefix.at(-1)?.seq ?? 0
      }
      await writeMeta({ file: threadMetaFile({ sessionDir, threadId: into }), meta })
      registry.registerThread({ sessionDir, threadId: into })
      return { meta, sessionDir }
    },
  })
  await writeSessionMetaForRoot({ registry, sessionDir: created.sessionDir, root: created.meta, home: homeOf({ source: created.meta, fromDir }) })
  return toThreadSummary(created.meta)
}
