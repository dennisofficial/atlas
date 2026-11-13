import { join } from 'node:path'

import { toCallId, toRunId, toThreadId, type InboxEntry, type V2Event } from '@dltech/atlas-core'
import {
  EOperatorRequestKind,
  EOperatorRequestOutcome,
  OPERATOR_INPUT_ASKED,
  type OperatorInputAsked,
} from '@dltech/atlas-plugin-operator/core'
import { ECallFailure, ECallStatus, type CallOp, type CallResult } from '@dltech/atlas-protocol'

import type { RemoteCalls } from '../../calls/remote-calls'
import { operatorAnswersOf } from '../operator-answer'
import { operatorInputOf } from '../operator-input'
import type {
  OperatorAnswer,
  OperatorDeliveryResult,
  OperatorRequestPort,
} from '../operator-requests'
import type { SessionRecord } from '../record/record-adapter'

export const SESSION = 'ses_1'
export const THREAD = toThreadId('thr_1')
export const SESSION_DIR = '/atlas/home/sessions/ses_1'
export const REQUEST = 'oreq_1'
export const CALL = toCallId('call_1')
export const VALUE = 'marked-value-6f2a'
export const PATH = join(SESSION_DIR, 'requests', REQUEST)

const stamped = (index: number) => ({
  id: `evt_${index + 1}`,
  seq: index + 1,
  threadId: THREAD,
  runId: toRunId('run_1'),
  at: '2026-11-12T03:00:00.000Z',
})

const asked = (kind: 'input' | 'shell'): OperatorInputAsked => ({
  type: OPERATOR_INPUT_ASKED,
  requestId: REQUEST,
  kind: kind === 'shell' ? EOperatorRequestKind.Shell : EOperatorRequestKind.Input,
  prompt: 'the login code',
  secret: true,
  ...(kind === 'shell' ? { shellId: 'shl_1' } : {}),
  sessionId: SESSION,
})

const callBodies = () => [
  { type: 'tool-called', callId: CALL, name: 'operator_input', input: {}, ordinal: 0 },
  { type: 'tool-dispatched', callId: CALL, name: 'operator_input' },
  { type: 'tool-parked', callId: CALL, name: 'operator_input' },
]

const stampedAll = (bodies: readonly object[]): V2Event[] =>
  bodies.map((body, index) => ({ ...stamped(index), ...body })) as unknown as V2Event[]

export const parkedCallOf = (): V2Event[] => stampedAll(callBodies())

export const parkedFromAsk = (kind: 'input' | 'shell'): V2Event[] =>
  stampedAll([...callBodies(), asked(kind)])

export const closedFromAsk = (kind: 'input' | 'shell'): V2Event[] =>
  stampedAll([
    ...callBodies(),
    asked(kind),
    { type: 'tool-result', callId: CALL, name: 'operator_input', modelText: '' },
  ])

export const entryOf = (requestId = REQUEST): InboxEntry => ({
  inboxId: 7,
  sessionId: SESSION,
  kind: 'operator-answer',
  payload: JSON.stringify({ requestId }),
  postedAt: '2026-11-12T03:00:00.000Z',
  consumedSeq: null,
  senderSessionId: null,
})

export type AnswerRigOptions = {
  kind?: 'input' | 'shell'
  failure?: { code: ECallFailure; op: string } | undefined
  events?: readonly V2Event[] | undefined
}

export const answerRigOf = (options?: AnswerRigOptions) => {
  const kind = options?.kind ?? 'input'
  const log: V2Event[] = [...(options?.events ?? parkedFromAsk(kind))]
  const appended: unknown[] = []
  const calls: CallOp[] = []
  const settlements: { requestId: string; outcome: EOperatorRequestOutcome }[] = []
  const results: { requestId: string; result: OperatorDeliveryResult }[] = []
  let answer: OperatorAnswer | undefined
  let opens = 0

  const requests: OperatorRequestPort = {
    open: async () => {
      opens += 1
      return { requestId: REQUEST }
    },
    settle: async (args) => {
      settlements.push({ requestId: args.requestId, outcome: args.outcome })
      return true
    },
    answers: {
      take: () => answer,
      resolve: (params) => {
        results.push(params)
      },
    },
  }
  const callsPort = {
    invoke: async ({ op }: { op: CallOp }): Promise<CallResult> => {
      calls.push(op)
      if (options?.failure?.op === op.op)
        return {
          status: ECallStatus.Failed,
          op: op.op,
          error: { code: options.failure.code, message: `${op.op} refused` },
        }
      return { status: ECallStatus.Ok, op: op.op, value: null } as CallResult
    },
  } as unknown as RemoteCalls
  const logDrafts = (drafts: readonly unknown[]): void => {
    for (const draft of drafts)
      log.push({ ...stamped(log.length), ...(draft as object) } as unknown as V2Event)
  }
  const record = {
    append: async ({ drafts }: { drafts: readonly unknown[] }): Promise<never[]> => {
      appended.push(...drafts)
      logDrafts(drafts)
      return []
    },
    eventCache: () => ({ eventsAfter: () => log }),
  } as unknown as SessionRecord
  const args = {
    requests,
    sessionId: SESSION,
    threadId: THREAD,
    record,
    newRunId: () => toRunId('run_2'),
  }

  const park = async (): Promise<void> => {
    await record.append({
      threadId: THREAD,
      runId: toRunId('run_1'),
      drafts: [
        { type: 'tool-called', callId: CALL, name: 'operator_input', input: {}, ordinal: 0 },
        { type: 'tool-dispatched', callId: CALL, name: 'operator_input' },
        { type: 'tool-parked', callId: CALL, name: 'operator_input' },
      ],
    })
  }

  return {
    intake: operatorAnswersOf({ ...args, calls: callsPort, sessionDir: SESSION_DIR }),
    input: operatorInputOf(args),
    park,
    appended,
    log,
    calls,
    results,
    settlements,
    opens: () => opens,
    appendToLog: async (drafts: readonly unknown[]) => logDrafts(drafts),
    hand: (value: OperatorAnswer | undefined) => {
      answer = value
    },
  }
}
