import { describe, expect, it } from 'bun:test'

import { ECrashedCall } from '@dltech/atlas-agent'
import {
  EToolEffect,
  toCallId,
  toRunId,
  toThreadId,
  type EventDraft,
  type PendingCall,
  type RecordEvent,
} from '@dltech/atlas-core'
import {
  ECallStatus,
  EServiceRunStatus,
  type CallOp,
  type CallResult,
} from '@dltech/atlas-protocol'

import { runInCallScope } from '../../calls/call-scope'
import { handedOffResult, wasHandedOff } from '../../calls/remote-calls-frames'
import { InFlightSteps, type StepEvent } from '../../calls/step-detach'
import { crashSettleOf } from '../crash-settle'
import { pluginCallOf } from '../plugin-call'
import type { SessionRuntime } from '../ports'
import { RecordBookkeeping } from '../record/record-bookkeeping'
import type { SessionRecord } from '../record/record-adapter'
import { recordStep, recordedStepsOf } from '../record/call-steps'

const CALL_ID = '11111111-1111-4111-8111-111111111111'
const THREAD_ID = toThreadId('33333333-3333-4333-8333-333333333333')
const RUN_ID = toRunId('22222222-2222-4222-8222-222222222222')
const SERVER_ID = 's1.docs'
const LINE = '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"search"}}'

type FakeDaemon = {
  call(op: CallOp): Promise<CallResult>
  sent: string[]
}

const daemonOf = (): FakeDaemon => {
  const sent: string[] = []
  const call = async (op: CallOp): Promise<CallResult> => {
    if (op.op === 'mcp.spawn') {
      return {
        status: ECallStatus.Ok,
        op: 'mcp.spawn',
        value: { serverId: op.serverId, pid: 1, attached: false, seq: 0 },
      }
    }
    if (op.op === 'mcp.send') {
      sent.push(op.line)
      return { status: ECallStatus.Ok, op: 'mcp.send', value: null }
    }
    if (op.op === 'mcp.read') {
      return {
        status: ECallStatus.Ok,
        op: 'mcp.read',
        value: { lines: [], stderr: [], ended: null },
      }
    }
    if (op.op === 'services.stop') {
      return {
        status: ECallStatus.Ok,
        op: 'services.stop',
        value: {
          serviceId: op.serviceId,
          command: 'bun run api',
          pid: 1,
          port: null,
          status: EServiceRunStatus.Stopped,
          exitCode: 0,
          signal: null,
          startedAt: 0,
        },
      }
    }
    throw new Error(`the fake daemon does not answer ${op.op}`)
  }
  return { call, sent }
}

const fakeRecordOf = (): SessionRecord => {
  const book = new RecordBookkeeping()
  let seq = 0
  const append = async (args: { drafts: readonly EventDraft[] }): Promise<void> => {
    for (const draft of args.drafts) {
      seq += 1
      book.step({
        ...draft,
        id: `e${seq}`,
        seq,
        threadId: THREAD_ID,
        at: '2026-11-26T10:00:00.000Z',
      } as RecordEvent)
    }
  }
  return { eventCache: () => ({ bookkeeping: () => book }), append } as unknown as SessionRecord
}

const podOf = (args: {
  daemon: FakeDaemon
  record: SessionRecord
  draining?: boolean
  steps?: InFlightSteps
}) =>
  pluginCallOf({
    invoke: async (request) => {
      if (args.draining === true && request.detachOnHandoff === true) {
        return handedOffResult({ op: request.op, delivered: 0 })
      }
      return await args.daemon.call(request.op)
    },
    steps: {
      recorded: (scopeKey) => recordedStepsOf({ record: args.record, scopeKey }),
      record: (step) =>
        recordStep({ record: args.record, threadId: THREAD_ID, runId: RUN_ID, step }),
    },
    bootId: () => 'boot-a',
    ...(args.steps === undefined ? {} : { onStep: (event: StepEvent) => args.steps?.apply(event) }),
  })

const dispatchedDraftOf = (): EventDraft => ({
  type: 'tool-dispatched',
  callId: toCallId(CALL_ID),
  name: 'mcp_docs_search',
  bootId: 'boot-a',
})

const runtimeOf = (): SessionRuntime =>
  ({
    daemonTools: new Set(['bash']),
    effectOf: () => EToolEffect.Write,
  }) as unknown as SessionRuntime

describe('mcp ops in a call scope', () => {
  it('holds a tool call that crashed after an mcp send, which opened no step of its own', async () => {
    const daemon = daemonOf()
    const record = fakeRecordOf()
    const pod = podOf({ daemon, record })

    await runInCallScope({
      scopeKey: CALL_ID,
      body: async () => {
        await record.append({
          threadId: THREAD_ID,
          runId: RUN_ID,
          drafts: [dispatchedDraftOf()],
        })
        await pod({ op: 'mcp.spawn', serverId: SERVER_ID, command: 'bun' })
        await pod({ op: 'mcp.send', serverId: SERVER_ID, line: LINE })
      },
    })

    expect(daemon.sent).toEqual([LINE])
    expect(recordedStepsOf({ record, scopeKey: CALL_ID })).toHaveLength(0)
    expect(crashSettleOf()).toBe(ECrashedCall.Hold)
    expect(daemon.sent).toEqual([LINE])
  })

  it('does not detach an mcp call a drain handed off, and records no synthetic result', async () => {
    const daemon = daemonOf()
    const record = fakeRecordOf()
    const steps = new InFlightSteps()
    const pod = podOf({ daemon, record, draining: true, steps })

    const result = await runInCallScope({
      scopeKey: CALL_ID,
      body: async () => await pod({ op: 'mcp.send', serverId: SERVER_ID, line: LINE }),
    })

    expect(steps.detached(CALL_ID)).toBe(false)
    expect(wasHandedOff(result)).toBe(false)
    expect(result.status).toBe(ECallStatus.Ok)
    expect(daemon.sent).toEqual([LINE])
  })

  it('gives a step op the next slot after an mcp call, so a replay finds it again', async () => {
    const record = fakeRecordOf()
    const pod = podOf({ daemon: daemonOf(), record })

    await runInCallScope({
      scopeKey: CALL_ID,
      body: async () => {
        await pod({ op: 'mcp.send', serverId: SERVER_ID, line: LINE })
        await pod({ op: 'services.stop', serviceId: 'api' })
      },
    })

    expect(recordedStepsOf({ record, scopeKey: CALL_ID }).map((step) => step.key)).toEqual([
      `${CALL_ID}.0`,
    ])
  })
})
