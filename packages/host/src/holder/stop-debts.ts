import {
  crashedCallsOf,
  owedStopScopesOf,
  stopDebtMarkOf,
  STOP_OWED_KIND,
  STOP_PAID_KIND,
  stopOwedKeyOf,
  stopPaidKeyOf,
  type LoopState,
  type RecordBody,
  type RunId,
  type StopDebtMark,
  type ThreadId,
} from '@dltech/atlas-core'
import { EDaemonCapability } from '@dltech/atlas-protocol'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import { scopeKeyOf } from '../calls/call-scope'
import type { RemoteCalls } from '../calls/remote-calls'
import type { SessionRecord } from './record/record-adapter'
import type { RecordCache } from './record/record-cache'
import type { FactCache } from './record/record-facts'

export type FactDraft = Extract<RecordBody, { type: 'fact-recorded' }>

export type StopDebtTarget = {
  readonly threadId: ThreadId
  append(args: { threadId: ThreadId; runId: RunId; drafts: readonly FactDraft[] }): Promise<unknown>
}

export type OwingCache = FactCache & Pick<RecordCache, 'loopState'>

export type StopDebtSource = {
  eventCache(): OwingCache
  queue<T>(work: () => Promise<T>): Promise<T>
}

export type StopDebtRecord = StopDebtTarget & { eventCache(): FactCache }

export type StopDebtCalls = Pick<
  RemoteCalls,
  'daemonCapabilities' | 'cancelScope' | 'onReady' | 'onScopeCancelled'
>

export type StopDebtPorts = {
  record: StopDebtRecord
  calls: StopDebtCalls
  runId(): RunId
  log?: LogPort | undefined
}

export const stoppedScopesOf = (state: LoopState): readonly string[] => {
  const scopes: string[] = []
  for (const call of crashedCallsOf(state)) {
    const scope = scopeKeyOf({ runId: call.runId, callId: call.callId })
    if (!scopes.includes(scope)) scopes.push(scope)
  }
  return scopes
}

export const stopOwedDraftOf = (scope: string): FactDraft => ({
  type: 'fact-recorded',
  key: stopOwedKeyOf(scope),
  kind: STOP_OWED_KIND,
})

const appendOwed = async (args: {
  source: StopDebtSource
  target: StopDebtTarget
  runId(): RunId
}): Promise<void> => {
  const scopes = stoppedScopesOf(args.source.eventCache().loopState())
  if (scopes.length === 0) return
  await args.target.append({
    threadId: args.target.threadId,
    runId: args.runId(),
    drafts: scopes.map(stopOwedDraftOf),
  })
}

const warnAppendFailed = (args: {
  log?: LogPort | undefined
  threadId: ThreadId
  error: unknown
}): void => {
  args.log?.warn({
    source: 'holder.stop-debts',
    message: `recording the stopped pod work of ${args.threadId} failed`,
    ...logFieldsOf({ error: args.error }),
  })
}

export const oweChildStoppedCalls = async (args: {
  child: StopDebtSource
  parent: StopDebtTarget
  runId(): RunId
  log?: LogPort | undefined
}): Promise<void> => {
  try {
    await args.child.queue(() =>
      appendOwed({ source: args.child, target: args.parent, runId: args.runId }),
    )
  } catch (error) {
    warnAppendFailed({ log: args.log, threadId: args.parent.threadId, error })
  }
}

export const oweOwnStoppedTurn = async (args: {
  record: Pick<SessionRecord, 'threadId' | 'oweStoppedTurn'> | undefined
  runId(): RunId
  log?: LogPort | undefined
}): Promise<void> => {
  const { record } = args
  if (record === undefined) return
  try {
    await record.oweStoppedTurn({ threadId: record.threadId, runId: args.runId })
  } catch (error) {
    warnAppendFailed({ log: args.log, threadId: record.threadId, error })
  }
}

const marksOf = (cache: FactCache): readonly StopDebtMark[] => {
  const marks: StopDebtMark[] = []
  for (const event of cache.eventsAfter(0)) {
    if (event.type === 'tool-dispatched') {
      marks.push({
        kind: 'dispatched',
        scope: scopeKeyOf({ runId: event.runId, callId: event.callId }),
      })
      continue
    }
    if (event.type !== 'fact-recorded') continue
    const resolved = cache.resolvedEvent(event)
    if (resolved.type !== 'fact-recorded') continue
    const mark = stopDebtMarkOf(resolved)
    if (mark !== undefined) marks.push(mark)
  }
  return marks
}

const owedScopesOf = (record: StopDebtRecord): readonly string[] =>
  owedStopScopesOf(marksOf(record.eventCache()))

export const payStopDebts = (args: StopDebtPorts): void => {
  if (!args.calls.daemonCapabilities().includes(EDaemonCapability.CancelScope)) return
  for (const scope of owedScopesOf(args.record)) args.calls.cancelScope({ scope })
}

export const watchStopDebts = (args: StopDebtPorts): void => {
  args.calls.onScopeCancelled(({ scope }) => {
    if (!owedScopesOf(args.record).includes(scope)) return
    void args.record
      .append({
        threadId: args.record.threadId,
        runId: args.runId(),
        drafts: [{ type: 'fact-recorded', key: stopPaidKeyOf(scope), kind: STOP_PAID_KIND }],
      })
      .catch((error: unknown) => {
        warnAppendFailed({ log: args.log, threadId: args.record.threadId, error })
      })
  })
}

export const wireStopDebts = (args: StopDebtPorts): void => {
  watchStopDebts(args)
  args.calls.onReady(() => payStopDebts(args))
  payStopDebts(args)
}
