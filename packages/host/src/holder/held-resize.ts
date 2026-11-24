import {
  EInputConsumed,
  inboxEventOf,
  openPodResize,
  resizeSettledIn,
  type InboxEntry,
  type RunId,
} from '@dltech/atlas-core'

import { resizeInterruptReason } from '../calls/errors'
import type { RemoteCalls } from '../calls/remote-calls'
import {
  carriesPodResized,
  isPodResizeStarted,
  podResizedOf,
  podResizeStartedOf,
} from './held-inbox'
import type { AppendBody, SessionRecord } from './record/record-adapter'

export type ResizeCalls = Pick<
  RemoteCalls,
  'armResize' | 'resizeStarted' | 'resizeSettled' | 'resizeHeld'
>

export const reconcileResizeGate = (args: {
  record: SessionRecord | undefined
  runtime: { remoteCalls: ResizeCalls } | undefined
}): void => {
  const calls = args.record === undefined ? undefined : args.runtime?.remoteCalls
  if (args.record === undefined || calls === undefined) return
  const events = args.record.eventCache().eventsAfter(0)
  const open = openPodResize(events)
  if (open !== undefined) {
    calls.armResize({ open, reason: resizeInterruptReason(open) })
    return
  }
  const held = calls.resizeHeld()
  if (held === undefined) return
  if (resizeSettledIn({ events, generation: held.generation })) {
    calls.resizeSettled({ generation: held.generation })
  }
}

const consumeResizeEntries = async (args: {
  entries: readonly InboxEntry[]
  record: SessionRecord
  runId: RunId
}): Promise<void> => {
  const drafts: AppendBody[] = []
  for (const entry of args.entries) {
    const read = inboxEventOf(entry.payload)
    if (!read.ok) continue
    drafts.push(read.event, {
      type: 'input-consumed',
      inboxId: entry.inboxId,
      consumed: EInputConsumed.Discarded,
    })
  }
  if (drafts.length === 0) return
  await args.record.append({ threadId: args.record.threadId, runId: args.runId, drafts })
}

export const handleResizeEntries = async (args: {
  entries: readonly InboxEntry[]
  record: SessionRecord | undefined
  calls: ResizeCalls | undefined
  runId(): RunId
}): Promise<boolean> => {
  const started = args.entries.filter(isPodResizeStarted)
  const resized = args.entries.filter(carriesPodResized)
  if (started.length === 0 && resized.length === 0) return false
  for (const entry of started) {
    const open = podResizeStartedOf(entry)
    if (open === undefined) continue
    args.calls?.resizeStarted({
      open: {
        generation: open.generation,
        vcpus: open.vcpus,
        memoryGb: open.memoryGb,
        startedAt: Date.parse(entry.postedAt),
      },
      reason: resizeInterruptReason(open),
    })
  }
  for (const entry of resized) {
    const notice = podResizedOf(entry)
    if (notice === undefined) continue
    args.calls?.resizeSettled({ generation: notice.generation })
  }
  if (args.record !== undefined) {
    await consumeResizeEntries({
      entries: [...started, ...resized],
      record: args.record,
      runId: args.runId(),
    })
  }
  return true
}
