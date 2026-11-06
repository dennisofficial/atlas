import type { LogHead, V2Event, V2EventType } from '@dltech/atlas-core'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import { markDispatched, scopeKeyOf } from '../../calls/call-scope'
import type { RemoteCalls } from '../../calls/remote-calls'
import { RecordCorruptionError, type AppendBody } from './append-drafts'
import type { RecordCache } from './record-cache'

export const ackDaemonScope = async (args: {
  callId: string
  name: string
  runId: string
  daemonTools: ReadonlySet<string>
  remoteCalls: RemoteCalls
  log?: LogPort | undefined
}): Promise<void> => {
  if (!args.daemonTools.has(args.name)) return
  try {
    await args.remoteCalls.ackScope({
      scopeKey: scopeKeyOf({ runId: args.runId, callId: args.callId }),
    })
  } catch (error) {
    args.log?.error({
      source: 'holder.record',
      message: `acking the daemon scope of ${args.name} failed; the daemon prunes it at boot`,
      data: { tool: args.name },
      ...logFieldsOf({ error }),
    })
  }
}

export const ackRecordedDaemonResults = async (args: {
  cache: RecordCache
  daemonTools: ReadonlySet<string>
  remoteCalls: RemoteCalls
  log?: LogPort | undefined
}): Promise<void> => {
  const events = [...args.cache.all()]
  let lastUserSaidSeq = 0
  for (const event of events) {
    if (event.type === 'user-said') lastUserSaidSeq = event.seq
  }
  const dispatched = new Map<string, { runId: string; name: string }>()
  for (const event of events) {
    if (event.seq <= lastUserSaidSeq) continue
    if (event.type === 'tool-dispatched') {
      dispatched.set(event.callId, { runId: event.runId, name: event.name })
      continue
    }
    if (event.type !== 'tool-result') continue
    const call = dispatched.get(event.callId)
    if (call === undefined) continue
    dispatched.delete(event.callId)
    await ackDaemonScope({
      callId: event.callId,
      name: event.name,
      runId: call.runId,
      daemonTools: args.daemonTools,
      remoteCalls: args.remoteCalls,
      ...(args.log === undefined ? {} : { log: args.log }),
    })
  }
}

export const prepareDraft = async (
  args: { cache: RecordCache; daemonTools: ReadonlySet<string>; remoteCalls: RemoteCalls },
  draft: AppendBody,
): Promise<AppendBody | undefined> => {
  if (draft.type !== 'tool-dispatched') return draft
  const recorded = args.cache.findDispatched(draft.callId)
  if (recorded !== undefined) {
    if (recorded.bootId !== undefined && recorded.bootId !== null) {
      markDispatched({ bootId: recorded.bootId })
    }
    return undefined
  }
  if (!args.daemonTools.has(draft.name)) return draft
  await args.remoteCalls.ready()
  const bootId = args.remoteCalls.bootId()
  if (bootId === undefined) {
    throw new RecordCorruptionError('the daemon link had no bootId after ready() resolved')
  }
  markDispatched({ bootId })
  return { ...draft, bootId }
}

export const resyncHead = async (
  args: {
    plane: {
      head(params: { threadId: string }): Promise<LogHead>
      readEvents(params: {
        threadId: string
        afterSeq: number
        limit: number
        visible: boolean
        hiddenTypes?: readonly V2EventType[] | undefined
      }): Promise<{ events: V2Event[]; next?: number | undefined }>
    }
    threadId: string
  },
  cache: RecordCache,
): Promise<void> => {
  let lastSeq = cache.currentHead().seq
  for (;;) {
    const head = await args.plane.head({ threadId: args.threadId })
    const target: LogHead =
      head.seq > lastSeq ? head : { seq: lastSeq, hash: cache.currentHead().hash }
    for (;;) {
      const page = await args.plane.readEvents({
        threadId: args.threadId,
        afterSeq: lastSeq,
        limit: 1000,
        visible: false,
      })
      if (page.events.length > 0) {
        const last = page.events[page.events.length - 1]
        if (last !== undefined) lastSeq = last.seq
        await cache.resolveBlobsOf(page.events)
        cache.extend({ events: page.events, head: { seq: lastSeq, hash: target.hash } })
      }
      if (page.next === undefined) break
    }
    if (target.seq <= lastSeq) {
      cache.replaceHead(target)
      await cache.refillIfRevealed()
      return
    }
  }
}
