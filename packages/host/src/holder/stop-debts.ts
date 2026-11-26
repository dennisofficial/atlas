import {
  owedStopScopesOf,
  STOP_OWED_KIND,
  STOP_PAID_KIND,
  stopOwedKeyOf,
  stopPaidKeyOf,
  type RecordBody,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'
import { EDaemonCapability } from '@dltech/atlas-protocol'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import { scopeKeyOf } from '../calls/call-scope'
import type { RemoteCalls } from '../calls/remote-calls'
import { factsOfKindsIn, type FactCache } from './record/record-facts'

export type FactDraft = Extract<RecordBody, { type: 'fact-recorded' }>

export type StopDebtRecord = {
  readonly threadId: ThreadId
  eventCache(): FactCache
  append(args: { threadId: ThreadId; runId: RunId; drafts: readonly FactDraft[] }): Promise<unknown>
}

export type StopDebtCalls = Pick<
  RemoteCalls,
  'daemonCapabilities' | 'cancelScope' | 'onReady' | 'onScopeCancelled'
>

const STOP_DEBT_KINDS: ReadonlySet<string> = new Set([STOP_OWED_KIND, STOP_PAID_KIND])

type StopDebtEvent = { type: string; callId?: string | undefined; runId?: string | undefined }

const settledCallIdsOf = (events: readonly StopDebtEvent[]): ReadonlySet<string> => {
  const settled = new Set<string>()
  for (const event of events) {
    if (event.type !== 'tool-result' && event.type !== 'tool-denied') continue
    if (event.callId !== undefined) settled.add(event.callId)
  }
  return settled
}

export const openCallScopesOf = (events: readonly StopDebtEvent[]): readonly string[] => {
  const settled = settledCallIdsOf(events)
  const scopes: string[] = []
  for (const event of events) {
    if (event.type !== 'tool-dispatched') continue
    if (event.callId === undefined || event.runId === undefined) continue
    if (settled.has(event.callId)) continue
    const scope = scopeKeyOf({ runId: event.runId, callId: event.callId })
    if (!scopes.includes(scope)) scopes.push(scope)
  }
  return scopes
}

export const oweStoppedCalls = async (args: {
  record: StopDebtRecord
  runId(): RunId
  log?: LogPort | undefined
}): Promise<void> => {
  const scopes = openCallScopesOf(args.record.eventCache().eventsAfter(0))
  if (scopes.length === 0) return
  try {
    await args.record.append({
      threadId: args.record.threadId,
      runId: args.runId(),
      drafts: scopes.map((scope) => ({
        type: 'fact-recorded' as const,
        key: stopOwedKeyOf(scope),
        kind: STOP_OWED_KIND,
      })),
    })
  } catch (error) {
    args.log?.warn({
      source: 'holder.stop-debts',
      message: `recording the stopped pod work of ${args.record.threadId} failed`,
      ...logFieldsOf({ error }),
    })
  }
}

export type StopDebtPorts = {
  record: StopDebtRecord
  calls: StopDebtCalls
  runId(): RunId
  log?: LogPort | undefined
}

const owedScopesOf = (record: StopDebtRecord): readonly string[] =>
  owedStopScopesOf(factsOfKindsIn({ cache: record.eventCache(), kinds: STOP_DEBT_KINDS }))

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
        args.log?.warn({
          source: 'holder.stop-debts',
          message: `recording the cancelled pod work of ${args.record.threadId} failed`,
          ...logFieldsOf({ error }),
        })
      })
  })
}

export const wireStopDebts = (args: StopDebtPorts): void => {
  watchStopDebts(args)
  args.calls.onReady(() => payStopDebts(args))
  payStopDebts(args)
}
