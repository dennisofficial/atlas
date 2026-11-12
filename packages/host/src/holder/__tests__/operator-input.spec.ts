import { join } from 'node:path'

import { toRunId, toThreadId } from '@dltech/atlas-core'
import {
  EOperatorRequestKind,
  EOperatorRequestOutcome,
  OPERATOR_INPUT_ASKED,
  OPERATOR_INPUT_SETTLED,
  type OperatorInputAsked,
  type OperatorInputSettled,
} from '@dltech/atlas-plugin-operator/core'
import type { PodOperatorAsk } from '@dltech/atlas-plugin-sdk'
import { ECallFailure, ECallStatus, type CallOp, type CallResult } from '@dltech/atlas-protocol'
import { describe, expect, it } from 'bun:test'

import type { RemoteCalls } from '../../calls/remote-calls'
import { operatorInputOf } from '../operator-input'
import type {
  OperatorRequestAnswer,
  OperatorRequestOpen,
  OperatorRequestPort,
} from '../operator-requests'
import type { SessionRecord } from '../record/record-adapter'

const SESSION = 'ses_1'
const THREAD = toThreadId('thr_1')
const SESSION_DIR = '/atlas/home/sessions/ses_1'
const REQUEST = 'oreq_1'
const EXPIRES_AT = new Date('2026-11-12T03:15:00.000Z')
const VALUE = 'marked-value-6f2a'

type Event = OperatorInputAsked | OperatorInputSettled

const askOf = (kind: 'input' | 'shell'): PodOperatorAsk =>
  kind === 'shell'
    ? { kind: 'shell', prompt: 'the login code', secret: true, shellId: 'shl_1' }
    : { kind: 'input', prompt: 'the login code', secret: true }

const failWith = (code: ECallFailure, op: string): CallResult => ({
  status: ECallStatus.Failed,
  op,
  error: { code, message: `${op} refused` },
})

const rigOf = (options?: {
  failing?: { op: string; code: ECallFailure } | undefined
  openThrows?: string | undefined
}) => {
  const calls: CallOp[] = []
  const events: Event[] = []
  const abandoned: string[] = []
  const waits: string[] = []
  let answer: ((answer: OperatorRequestAnswer) => void) | undefined

  const requests: OperatorRequestPort = {
    open: async () => {
      if (options?.openThrows !== undefined) throw new Error(options.openThrows)
      const opened: OperatorRequestOpen = {
        requestId: REQUEST,
        expiresAt: EXPIRES_AT,
        answered: new Promise<OperatorRequestAnswer>((resolve) => {
          answer = resolve
        }),
        abandon: (reason) => {
          abandoned.push(reason)
        },
      }
      return opened
    },
  }
  const callsPort = {
    invoke: async ({ op }: { op: CallOp }): Promise<CallResult> => {
      calls.push(op)
      if (options?.failing?.op === op.op) return failWith(options.failing.code, op.op)
      return { status: ECallStatus.Ok, op: op.op, value: null } as CallResult
    },
  } as unknown as RemoteCalls
  const record = {
    append: async ({ drafts }: { drafts: readonly Event[] }): Promise<never[]> => {
      events.push(...drafts)
      return []
    },
  } as unknown as SessionRecord

  const input = operatorInputOf({
    requests,
    awaiting: {
      begin: () => {
        waits.push('begin')
        return () => waits.push('end')
      },
    },
    sessionId: SESSION,
    threadId: THREAD,
    sessionDir: SESSION_DIR,
    calls: callsPort,
    record,
    newRunId: () => toRunId('run_1'),
  })

  return {
    input,
    calls,
    events,
    abandoned,
    waits,
    answer: (value: OperatorRequestAnswer) => answer?.(value),
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const askedOf = async (args: {
  input: ReturnType<typeof rigOf>['input']
  events: Event[]
  ask: PodOperatorAsk
  signal: AbortSignal
}): Promise<{
  asking: ReturnType<ReturnType<typeof rigOf>['input']['ask']>
}> => {
  const asking = args.input.ask({ ask: args.ask, signal: args.signal })
  for (let attempt = 0; attempt < 20 && args.events.length === 0; attempt += 1) await tick()
  return { asking }
}

describe('the operator input adapter', () => {
  it('asks with the id and deadline, then writes the value to the session requests dir', async () => {
    const rig = rigOf()
    const { asking } = await askedOf({
      input: rig.input,
      events: rig.events,
      ask: askOf('input'),
      signal: new AbortController().signal,
    })

    expect(rig.events).toHaveLength(1)
    expect(rig.events[0]).toEqual({
      type: OPERATOR_INPUT_ASKED,
      requestId: REQUEST,
      kind: EOperatorRequestKind.Input,
      prompt: 'the login code',
      secret: true,
      expiresAt: EXPIRES_AT.toISOString(),
      sessionId: SESSION,
    })

    rig.answer({ ok: true, value: VALUE })
    const delivery = await asking

    const path = join(SESSION_DIR, 'requests', REQUEST)
    expect(delivery).toEqual({ ok: true, path, bytes: VALUE.length })
    expect(rig.calls).toEqual([
      { op: 'mkdir', path: join(SESSION_DIR, 'requests') },
      { op: 'writeFile', path, content: VALUE, mode: 0o600 },
    ])
    expect(rig.events).toHaveLength(2)
    expect(rig.events[1]).toEqual({
      type: OPERATOR_INPUT_SETTLED,
      requestId: REQUEST,
      outcome: EOperatorRequestOutcome.Delivered,
      path,
      bytes: VALUE.length,
      sessionId: SESSION,
    })
    expect(JSON.stringify(rig.events)).not.toContain(VALUE)
  })

  it('types the value into the stdin of the shell the ask names', async () => {
    const rig = rigOf()
    const { asking } = await askedOf({
      input: rig.input,
      events: rig.events,
      ask: askOf('shell'),
      signal: new AbortController().signal,
    })

    expect(rig.events[0]).toMatchObject({
      kind: EOperatorRequestKind.Shell,
      shellId: 'shl_1',
    })

    rig.answer({ ok: true, value: VALUE })
    const delivery = await asking

    expect(delivery).toEqual({ ok: true, shellId: 'shl_1', bytes: VALUE.length })
    expect(rig.calls).toEqual([{ op: 'shells.write', shellId: 'shl_1', data: VALUE, end: false }])
    expect(rig.events[1]).toEqual({
      type: OPERATOR_INPUT_SETTLED,
      requestId: REQUEST,
      outcome: EOperatorRequestOutcome.Delivered,
      bytes: VALUE.length,
      sessionId: SESSION,
    })
    expect(JSON.stringify(rig.events)).not.toContain(VALUE)
  })

  it('abandons the request and settles it abandoned when the turn aborts', async () => {
    const rig = rigOf()
    const abort = new AbortController()
    const { asking } = await askedOf({
      input: rig.input,
      events: rig.events,
      ask: askOf('input'),
      signal: abort.signal,
    })

    abort.abort()
    const delivery = await asking

    expect(delivery).toEqual({ ok: false, reason: 'abandoned' })
    expect(rig.abandoned).toEqual(['abandoned'])
    expect(rig.calls).toEqual([])
    expect(rig.events[1]).toEqual({
      type: OPERATOR_INPUT_SETTLED,
      requestId: REQUEST,
      outcome: EOperatorRequestOutcome.Abandoned,
      reason: 'abandoned',
      sessionId: SESSION,
    })
  })

  it('holds the stall clock for the whole wait and releases it at the settle', async () => {
    const rig = rigOf()
    const { asking } = await askedOf({
      input: rig.input,
      events: rig.events,
      ask: askOf('input'),
      signal: new AbortController().signal,
    })

    expect(rig.waits).toEqual(['begin'])
    rig.answer({ ok: true, value: VALUE })
    await asking
    expect(rig.waits).toEqual(['begin', 'end'])
  })

  it('releases the hold when the request cannot be opened', async () => {
    const rig = rigOf({ openThrows: 'this session has no owner to ask for input' })

    await rig.input.ask({ ask: askOf('input'), signal: new AbortController().signal })

    expect(rig.waits).toEqual(['begin', 'end'])
  })

  it('settles cancelled, not abandoned, when the operator cancels', async () => {
    const rig = rigOf()
    const { asking } = await askedOf({
      input: rig.input,
      events: rig.events,
      ask: askOf('input'),
      signal: new AbortController().signal,
    })

    rig.answer({ ok: false, reason: 'cancelled' })
    const delivery = await asking

    expect(delivery).toEqual({ ok: false, reason: 'cancelled' })
    expect(rig.abandoned).toEqual([])
    expect(rig.events[1]).toMatchObject({ outcome: EOperatorRequestOutcome.Cancelled })
  })

  it('settles an expiry without writing anything', async () => {
    const rig = rigOf()
    const { asking } = await askedOf({
      input: rig.input,
      events: rig.events,
      ask: askOf('input'),
      signal: new AbortController().signal,
    })

    rig.answer({ ok: false, reason: 'expired' })
    const delivery = await asking

    expect(delivery).toEqual({ ok: false, reason: 'expired' })
    expect(rig.calls).toEqual([])
    expect(rig.events[1]).toMatchObject({
      outcome: EOperatorRequestOutcome.Expired,
      reason: 'expired',
    })
  })

  it('settles failed with the reason when the write is refused', async () => {
    const rig = rigOf({ failing: { op: 'writeFile', code: ECallFailure.PermissionDenied } })
    const { asking } = await askedOf({
      input: rig.input,
      events: rig.events,
      ask: askOf('input'),
      signal: new AbortController().signal,
    })

    rig.answer({ ok: true, value: VALUE })
    const delivery = await asking

    expect(delivery).toEqual({
      ok: false,
      reason: 'the value could not be written: writeFile refused',
    })
    expect(rig.events[1]).toMatchObject({
      outcome: EOperatorRequestOutcome.Failed,
      reason: 'the value could not be written: writeFile refused',
    })
    expect(JSON.stringify(rig.events)).not.toContain(VALUE)
  })

  it('answers a refusal to open with its reason and appends nothing', async () => {
    const rig = rigOf({ openThrows: 'this session is already waiting on an operator request' })

    const delivery = await rig.input.ask({
      ask: askOf('input'),
      signal: new AbortController().signal,
    })

    expect(delivery).toEqual({
      ok: false,
      reason: 'this session is already waiting on an operator request',
    })
    expect(rig.events).toEqual([])
    expect(rig.calls).toEqual([])
  })
})
