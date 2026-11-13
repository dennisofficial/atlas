import { join } from 'node:path'

import {
  stampDrafts,
  toCallId,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type EventDraft,
  type EventEnvelope,
  type InboxEntry,
  type JsonValue,
} from '@dltech/atlas-core'
import { EOperatorRequestKind } from '@dltech/atlas-plugin-operator/core'
import { ECallFailure, ECallStatus, type CallOp, type CallResult } from '@dltech/atlas-protocol'

import type { RemoteCalls } from '../../calls/remote-calls'
import { operatorAnswersOf } from '../operator-answer'
import type {
  OperatorAnswer,
  OperatorAnswerHandoff,
  OperatorAnswerKey,
  OperatorDeliveryResult,
  OperatorRequestPort,
} from '../operator-requests'
import type { SessionRecord } from '../record/record-adapter'

export const SESSION = 'ses_1'
export const THREAD = toThreadId('thr_1')
export const SESSION_DIR = '/atlas/home/sessions/ses_1'
export const CALL = toCallId('call_1')
export const OTHER = toCallId('call_2')
export const VALUE = 'marked-value-6f2a'
export const PATH = join(SESSION_DIR, 'requests', 'call_1')

const envelopeAt = (index: number): EventEnvelope => ({
  id: toEventId(`evt_${index + 1}`),
  seq: index + 1,
  threadId: THREAD,
  runId: toRunId('run_1'),
  depth: 0,
  at: '2026-11-12T03:00:00.000Z',
})

export const eventsOf = (drafts: readonly EventDraft[]): Event[] =>
  stampDrafts({ drafts, envelopes: drafts.map((_draft, index) => envelopeAt(index)) })

export const inputRequest = {
  kind: EOperatorRequestKind.Input,
  prompt: 'the login code',
} as const satisfies JsonValue

export const shellRequest = {
  kind: EOperatorRequestKind.Shell,
  prompt: 'the login code',
  shellId: 'shl_1',
} as const satisfies JsonValue

export const parkDrafts = (args: {
  callId: typeof CALL | typeof OTHER
  name?: string
  request?: JsonValue | undefined
}): EventDraft[] => {
  const name = args.name ?? 'operator_input'
  return [
    { type: 'tool-called', callId: args.callId, name, input: {}, ordinal: 0 },
    { type: 'tool-dispatched', callId: args.callId, name },
    {
      type: 'tool-parked',
      callId: args.callId,
      name,
      ...(args.request === undefined ? {} : { request: args.request }),
    },
  ]
}

export const entryOf = (callId: string = CALL): InboxEntry => ({
  inboxId: 7,
  sessionId: SESSION,
  kind: 'operator-answer',
  payload: JSON.stringify({ callId }),
  postedAt: '2026-11-12T03:00:00.000Z',
  consumedSeq: null,
  senderSessionId: null,
})

export type AnswerRigOptions = {
  kind?: 'input' | 'shell' | undefined
  drafts?: readonly EventDraft[] | undefined
  failure?: { code: ECallFailure; op: string } | undefined
}

export const answerRigOf = (options?: AnswerRigOptions) => {
  const request = options?.kind === 'shell' ? shellRequest : inputRequest
  const drafts: EventDraft[] = [...(options?.drafts ?? parkDrafts({ callId: CALL, request }))]
  const appended: EventDraft[] = []
  const calls: CallOp[] = []
  const results: { key: OperatorAnswerKey; result: OperatorDeliveryResult }[] = []
  let answer: OperatorAnswer | undefined

  const answers: OperatorAnswerHandoff = {
    take: () => answer,
    resolve: (params) => {
      results.push(params)
    },
  }
  const requests: OperatorRequestPort = { answers }
  const callsPort = {
    invoke: async ({ op }: { op: CallOp }): Promise<CallResult> => {
      calls.push(op)
      if (options?.failure?.op === op.op)
        return {
          status: ECallStatus.Failed,
          op: op.op,
          error: { code: options.failure.code, message: `${op.op} refused` },
        }
      return { status: ECallStatus.Ok, op: op.op, value: null } as unknown as CallResult
    },
  } as unknown as RemoteCalls
  const record = {
    append: async ({ drafts: added }: { drafts: readonly EventDraft[] }): Promise<never[]> => {
      appended.push(...added)
      drafts.push(...added)
      return []
    },
    eventCache: () => ({ visibleLoopEvents: () => eventsOf(drafts) }),
  } as unknown as SessionRecord

  return {
    intake: operatorAnswersOf({
      requests,
      calls: callsPort,
      sessionId: SESSION,
      threadId: THREAD,
      sessionDir: SESSION_DIR,
      record,
      newRunId: () => toRunId('run_2'),
    }),
    appended,
    draftLog: drafts,
    calls,
    results,
    events: () => eventsOf(drafts),
    park: async (callId: typeof CALL | typeof OTHER, parkedRequest: JsonValue | undefined) => {
      drafts.push(...parkDrafts({ callId, request: parkedRequest }))
    },
    hand: (value: OperatorAnswer | undefined) => {
      answer = value
    },
  }
}
