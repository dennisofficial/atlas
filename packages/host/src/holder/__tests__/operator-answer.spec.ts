import { join } from 'node:path'

import { toThreadId, type V2Event } from '@dltech/atlas-core'
import {
  EOperatorRequestKind,
  EOperatorRequestOutcome,
  OPERATOR_INPUT_ASKED,
  OPERATOR_INPUT_SETTLED,
} from '@dltech/atlas-plugin-operator/core'
import { ECallFailure, ECallStatus, type CallOp, type CallResult } from '@dltech/atlas-protocol'
import type { InboxEntry } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import type { RemoteCalls } from '../../calls/remote-calls'
import { operatorAnswersOf } from '../operator-answer'
import type {
  OperatorAnswer,
  OperatorDeliveryResult,
  OperatorRequestPort,
} from '../operator-requests'
import type { SessionRecord } from '../record/record-adapter'

const SESSION = 'ses_1'
const THREAD = toThreadId('thr_1')
const SESSION_DIR = '/atlas/home/sessions/ses_1'
const REQUEST = 'oreq_1'
const CALL = 'call_1'
const VALUE = 'marked-value-6f2a'
const PATH = join(SESSION_DIR, 'requests', REQUEST)

const envelope = { seq: 1, threadId: THREAD, runId: 'run_1', createdAt: '2026-11-12T03:00:00.000Z' }

const eventsOf = (kind: 'input' | 'shell'): V2Event[] =>
  [
    { ...envelope, type: 'tool-called', callId: CALL, name: 'operator_input', input: {} },
    { ...envelope, type: 'tool-dispatched', callId: CALL, name: 'operator_input' },
    { ...envelope, type: 'tool-parked', callId: CALL, name: 'operator_input' },
    {
      ...envelope,
      type: OPERATOR_INPUT_ASKED,
      requestId: REQUEST,
      kind: kind === 'shell' ? EOperatorRequestKind.Shell : EOperatorRequestKind.Input,
      prompt: 'the login code',
      secret: true,
      ...(kind === 'shell' ? { shellId: 'shl_1' } : {}),
      sessionId: SESSION,
    },
  ] as unknown as V2Event[]

const entryOf = (requestId = REQUEST): InboxEntry => ({
  inboxId: 7,
  sessionId: SESSION,
  kind: 'operator-answer',
  payload: JSON.stringify({ requestId }),
  postedAt: '2026-11-12T03:00:00.000Z',
  consumedSeq: null,
  senderSessionId: null,
})

const rigOf = (options?: {
  kind?: 'input' | 'shell'
  failure?: { code: ECallFailure; op: string } | undefined
}) => {
  const appended: unknown[] = []
  const calls: CallOp[] = []
  const settlements: { requestId: string; outcome: EOperatorRequestOutcome }[] = []
  let answer: OperatorAnswer | undefined
  const results: { requestId: string; result: OperatorDeliveryResult }[] = []

  const requests: OperatorRequestPort = {
    open: async () => ({ requestId: REQUEST }),
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
  const record = {
    append: async ({ drafts }: { drafts: readonly unknown[] }): Promise<never[]> => {
      appended.push(...drafts)
      return []
    },
    eventCache: () => ({ eventsAfter: () => eventsOf(options?.kind ?? 'input') }),
  } as unknown as SessionRecord

  return {
    intake: operatorAnswersOf({
      requests,
      calls: callsPort,
      sessionId: SESSION,
      threadId: THREAD,
      sessionDir: SESSION_DIR,
      record,
      newRunId: () => 'run_2' as never,
    }),
    appended,
    calls,
    results,
    settlements,
    hand: (value: OperatorAnswer | undefined) => {
      answer = value
    },
  }
}

describe('the operator answer intake', () => {
  it('writes the value to a 0600 file, settles the request and closes the parked call', async () => {
    const rig = rigOf()
    rig.hand({ ok: true, value: VALUE })

    const outcome = await rig.intake.handle(entryOf())

    expect(outcome.wakesTurn).toBe(true)
    expect(rig.calls.map((op) => op.op)).toEqual(['mkdir', 'writeFile'])
    const written = rig.calls[1]
    expect(written).toMatchObject({ path: PATH, content: VALUE, mode: 0o600 })
    expect(rig.appended).toMatchObject([
      {
        type: OPERATOR_INPUT_SETTLED,
        requestId: REQUEST,
        outcome: EOperatorRequestOutcome.Delivered,
        path: PATH,
      },
      { type: 'tool-result', callId: CALL, name: 'operator_input' },
    ])
    expect(JSON.stringify(rig.appended)).not.toContain(VALUE)
    expect(rig.settlements).toEqual([
      { requestId: REQUEST, outcome: EOperatorRequestOutcome.Delivered },
    ])
    expect(rig.results).toEqual([{ requestId: REQUEST, result: { ok: true } }])
  })

  it('types the value into the shell instead of a file', async () => {
    const rig = rigOf({ kind: 'shell' })
    rig.hand({ ok: true, value: VALUE })

    await rig.intake.handle(entryOf())

    expect(rig.calls.map((op) => op.op)).toEqual(['shells.write'])
    expect(JSON.stringify(rig.appended)).not.toContain(VALUE)
  })

  it('cancels the parked call with a refusal when the operator cancels', async () => {
    const rig = rigOf()
    rig.hand({ ok: false, cancel: true })

    const outcome = await rig.intake.handle(entryOf())

    expect(outcome.wakesTurn).toBe(true)
    expect(rig.calls).toEqual([])
    expect(rig.appended).toMatchObject([
      { type: OPERATOR_INPUT_SETTLED, outcome: EOperatorRequestOutcome.Cancelled },
      {
        type: 'tool-result',
        callId: CALL,
        error: { message: expect.stringContaining('cancelled') },
      },
    ])
    expect(rig.settlements).toEqual([
      { requestId: REQUEST, outcome: EOperatorRequestOutcome.Cancelled },
    ])
  })

  it('leaves the request open when the file cannot be written so the operator can retry', async () => {
    const rig = rigOf({ failure: { code: ECallFailure.PermissionDenied, op: 'writeFile' } })
    rig.hand({ ok: true, value: VALUE })

    const outcome = await rig.intake.handle(entryOf())

    expect(outcome.wakesTurn).toBe(false)
    expect(rig.appended).toEqual([])
    expect(rig.settlements).toEqual([])
    expect(rig.results[0]?.result).toMatchObject({ ok: false })
  })

  it('settles failed and closes the call when the shell is gone', async () => {
    const rig = rigOf({
      kind: 'shell',
      failure: { code: ECallFailure.NotFound, op: 'shells.write' },
    })
    rig.hand({ ok: true, value: VALUE })

    const outcome = await rig.intake.handle(entryOf())

    expect(outcome.wakesTurn).toBe(true)
    expect(rig.appended).toMatchObject([
      { type: OPERATOR_INPUT_SETTLED, outcome: EOperatorRequestOutcome.Failed },
      { type: 'tool-result', callId: CALL },
    ])
    expect(rig.settlements).toEqual([
      { requestId: REQUEST, outcome: EOperatorRequestOutcome.Failed },
    ])
  })

  it('consumes the entry and wakes nothing when the handoff has no value', async () => {
    const rig = rigOf()

    const outcome = await rig.intake.handle(entryOf())

    expect(outcome.wakesTurn).toBe(false)
    expect(rig.calls).toEqual([])
    expect(rig.appended).toEqual([])
    expect(rig.settlements).toEqual([])
  })

  it('wakes nothing and settles nothing when the payload is malformed', async () => {
    const rig = rigOf()
    rig.hand({ ok: true, value: VALUE })

    const outcome = await rig.intake.handle({ ...entryOf(), payload: '{"requestId":""}' })
    const garbage = await rig.intake.handle({ ...entryOf(), payload: 'not json' })

    expect(outcome.wakesTurn).toBe(false)
    expect(garbage.wakesTurn).toBe(false)
    expect(rig.calls).toEqual([])
    expect(rig.appended).toEqual([])
    expect(rig.settlements).toEqual([])
  })

  it('settles the open request cancelled so a later message leaves no stuck card', async () => {
    const rig = rigOf()

    await rig.intake.cancelOpen({ reason: 'the operator sent a message instead of answering' })

    expect(rig.appended).toMatchObject([
      { type: OPERATOR_INPUT_SETTLED, outcome: EOperatorRequestOutcome.Cancelled },
      { type: 'tool-result', callId: CALL },
    ])
    expect(rig.settlements).toEqual([
      { requestId: REQUEST, outcome: EOperatorRequestOutcome.Cancelled },
    ])
    expect(rig.results).toEqual([{ requestId: REQUEST, result: { ok: true } }])
  })
})
