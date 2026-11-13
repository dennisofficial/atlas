import { join } from 'node:path'
import { z } from 'zod'

import { ECallFailure, ECallStatus, type CallOp, type CallResult } from '@dltech/atlas-protocol'
import {
  EOperatorRequestKind,
  EOperatorRequestOutcome,
  INBOX_KIND_OPERATOR_ANSWER,
  OPERATOR_INPUT_SETTLED,
  type OperatorInputSettled,
  deliveredTextOf,
  refusalTextOf,
} from '@dltech/atlas-plugin-operator/core'
import {
  openParkedCall,
  parkedResultDraft,
  type CallId,
  type Event,
  type InboxEntry,
  type RunId,
  type ThreadId,
  type V2Event,
} from '@dltech/atlas-core'

import type { RemoteCalls } from '../calls/remote-calls'
import type { OperatorAnswerHandoff, OperatorRequestPort } from './operator-requests'
import type { AppendBody, SessionRecord } from './record/record-adapter'

const REQUESTS_DIRECTORY = 'requests'
const REQUESTS_FILE_MODE = 0o600

const operatorAnswerSchema = z.strictObject({ requestId: z.string().min(1) })

const requestIdOf = (payload: string): string | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return undefined
  }
  const answer = operatorAnswerSchema.safeParse(parsed)
  return answer.success ? answer.data.requestId : undefined
}

export const OPERATOR_ANSWER_KIND = INBOX_KIND_OPERATOR_ANSWER

export type OperatorAnswerOutcome = { wakesTurn: boolean }

export type OperatorAnswerIntake = {
  handle(entry: InboxEntry): Promise<OperatorAnswerOutcome>
  cancelOpen(args: { reason: string }): Promise<void>
}

export type OperatorAnswersArgs = {
  requests: OperatorRequestPort
  calls: RemoteCalls
  sessionId: string
  threadId: ThreadId
  sessionDir: string
  record: SessionRecord
  newRunId: () => RunId
}

type Asked = Extract<V2Event, { type: 'operator-input-asked' }>

type OpenRequest = { asked: Asked; callId: CallId; name: string }

const openRequestsOf = (events: readonly V2Event[]): ReadonlyMap<string, Asked> => {
  const open = new Map<string, Asked>()
  for (const event of events) {
    if (event.type === 'operator-input-asked') open.set(event.requestId, event)
    if (event.type === 'operator-input-settled') open.delete(event.requestId)
  }
  return open
}

const nameOfCall = (args: { events: readonly V2Event[]; callId: CallId }): string | undefined => {
  let name: string | undefined
  for (const event of args.events)
    if (event.type === 'tool-called' && event.callId === args.callId)
      name = (event as Extract<V2Event, { type: 'tool-called' }>).name
  return name
}

const pairedOf = (events: readonly V2Event[]): OpenRequest | undefined => {
  const callId = openParkedCall(events as readonly Event[])
  if (callId === undefined) return undefined
  const asked = openRequestsOf(events).values().next()
  if (asked.done === true) return undefined
  const name = nameOfCall({ events, callId })
  if (name === undefined) return undefined
  return { asked: asked.value, callId, name }
}

const settledOf = (args: {
  requestId: string
  sessionId: string
  outcome: EOperatorRequestOutcome
  path?: string | undefined
  bytes?: number | undefined
  reason?: string | undefined
}): OperatorInputSettled => ({
  type: OPERATOR_INPUT_SETTLED,
  requestId: args.requestId,
  outcome: args.outcome,
  ...(args.path === undefined ? {} : { path: args.path }),
  ...(args.bytes === undefined ? {} : { bytes: args.bytes }),
  ...(args.reason === undefined ? {} : { reason: args.reason }),
  sessionId: args.sessionId,
})

export const operatorAnswersOf = (args: OperatorAnswersArgs): OperatorAnswerIntake => {
  const handoff: OperatorAnswerHandoff = args.requests.answers

  const invoke = (op: CallOp): Promise<CallResult> =>
    args.calls.invoke({ key: `${args.sessionId}:${op.op}`, op })

  const append = async (drafts: readonly AppendBody[]): Promise<void> => {
    if (drafts.length === 0) return
    await args.record.append({ threadId: args.threadId, runId: args.newRunId(), drafts })
  }

  const settleRow = async (settled: {
    requestId: string
    outcome: EOperatorRequestOutcome
  }): Promise<void> => {
    await args.requests.settle(settled).catch(() => false)
  }

  const deliver = async (params: {
    asked: Asked
    value: string
  }): Promise<
    | { ok: true; path?: string; shellId?: string; bytes: number }
    | { ok: false; reason: string; gone?: boolean }
  > => {
    const bytes = Buffer.byteLength(params.value, 'utf8')
    if (params.asked.kind === EOperatorRequestKind.Shell) {
      const shellId = params.asked.shellId ?? ''
      const written = await invoke({
        op: 'shells.write',
        shellId,
        data: params.value,
        end: false,
      })
      if (written.status === ECallStatus.Failed)
        return {
          ok: false,
          reason: `the value could not be typed into the shell: ${written.error.message}`,
          ...(written.error.code === ECallFailure.NotFound ? { gone: true } : {}),
        }
      return { ok: true, shellId, bytes }
    }
    const directory = join(args.sessionDir, REQUESTS_DIRECTORY)
    const path = join(directory, params.asked.requestId)
    const made = await invoke({ op: 'mkdir', path: directory })
    if (made.status === ECallStatus.Failed && made.error.code !== ECallFailure.AlreadyExists)
      return {
        ok: false,
        reason: `the requests directory could not be created: ${made.error.message}`,
      }
    const written = await invoke({
      op: 'writeFile',
      path,
      content: params.value,
      mode: REQUESTS_FILE_MODE,
    })
    if (written.status === ECallStatus.Failed)
      return { ok: false, reason: `the value could not be written: ${written.error.message}` }
    return { ok: true, path, bytes }
  }

  const settleDrafts = (params: {
    open: OpenRequest
    outcome: EOperatorRequestOutcome
    reason?: string | undefined
    path?: string | undefined
    bytes?: number | undefined
  }): readonly AppendBody[] => {
    const refuse = params.outcome !== EOperatorRequestOutcome.Delivered
    return [
      settledOf({
        requestId: params.open.asked.requestId,
        sessionId: args.sessionId,
        outcome: params.outcome,
        ...(params.path === undefined ? {} : { path: params.path }),
        ...(params.bytes === undefined ? {} : { bytes: params.bytes }),
        ...(params.reason === undefined ? {} : { reason: params.reason }),
      }),
      parkedResultDraft({
        callId: params.open.callId,
        name: params.open.name,
        ...(refuse
          ? { error: { message: refusalTextOf(params.reason ?? params.outcome) } }
          : {
              modelText: deliveredTextOf({
                kind: params.open.asked.kind,
                path: params.path,
                shellId: params.open.asked.shellId,
                bytes: params.bytes ?? 0,
              }),
            }),
      }),
    ]
  }

  const handle = async (entry: InboxEntry): Promise<OperatorAnswerOutcome> => {
    const requestId = requestIdOf(entry.payload)
    const open = pairedOf(args.record.eventCache().eventsAfter(0))
    if (requestId === undefined) return { wakesTurn: false }
    if (open === undefined || open.asked.requestId !== requestId) {
      handoff.resolve({ requestId, result: { ok: false, reason: 'the request is no longer open' } })
      return { wakesTurn: false }
    }
    const answer = handoff.take(requestId)
    if (answer === undefined) return { wakesTurn: false }

    if (!answer.ok) {
      const reason = 'the operator cancelled the request'
      await append(settleDrafts({ open, outcome: EOperatorRequestOutcome.Cancelled, reason }))
      await settleRow({ requestId, outcome: EOperatorRequestOutcome.Cancelled })
      handoff.resolve({ requestId, result: { ok: true } })
      return { wakesTurn: true }
    }

    const delivery = await deliver({ asked: open.asked, value: answer.value })
    if (!delivery.ok && delivery.gone !== true) {
      handoff.resolve({ requestId, result: { ok: false, reason: delivery.reason } })
      return { wakesTurn: false }
    }
    const outcome = delivery.ok ? EOperatorRequestOutcome.Delivered : EOperatorRequestOutcome.Failed
    const drafts = delivery.ok
      ? settleDrafts({
          open,
          outcome,
          ...(delivery.path === undefined ? {} : { path: delivery.path }),
          bytes: delivery.bytes,
        })
      : settleDrafts({ open, outcome, reason: delivery.reason })
    await append(drafts)
    await settleRow({ requestId, outcome })
    handoff.resolve({ requestId, result: { ok: true } })
    return { wakesTurn: true }
  }

  const cancelOpen = async (params: { reason: string }): Promise<void> => {
    const open = pairedOf(args.record.eventCache().eventsAfter(0))
    if (open === undefined) return
    const drafts = settleDrafts({
      open,
      outcome: EOperatorRequestOutcome.Cancelled,
      reason: params.reason,
    })
    await append(drafts)
    await settleRow({
      requestId: open.asked.requestId,
      outcome: EOperatorRequestOutcome.Cancelled,
    })
    handoff.resolve({
      requestId: open.asked.requestId,
      result: { ok: true },
    })
  }

  return { handle, cancelOpen }
}
