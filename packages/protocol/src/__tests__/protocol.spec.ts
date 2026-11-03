import { describe, expect, it } from 'bun:test'

import {
  ECallFailure,
  ECallStatus,
  EDaemonErrorKind,
  EExecOutcome,
  EProtection,
  ERunState,
  ackFrameSchema,
  daemonErrorFrameSchema,
  daemonFrameSchema,
  healthFrameSchema,
  helloReplyFrameSchema,
  hostFrameSchema,
  hostHelloFrameSchema,
  outputChunkFrameSchema,
  resultFrameSchema,
  runFrameSchema,
  runReplyFrameSchema,
  sessionCreateInputSchema,
  sessionEventsInputSchema,
  sessionListInputSchema,
  sessionPostInputSchema,
  sessionStatusInputSchema,
  type DaemonFrame,
  type HealthFrame,
  type ResultFrame,
  type RunReplyFrame,
} from '../index'

const roundTrips = <T>(schema: { parse: (value: unknown) => T }, value: unknown): T =>
  schema.parse(JSON.parse(JSON.stringify(value)))

describe('agent-host to daemon frames', () => {
  it('round-trips hello, run, ack, cancel and ping', () => {
    const hello = { kind: 'hello', sessionId: 's-1', epoch: 5, token: 'tok' } as const
    expect(roundTrips(hostFrameSchema, hello)).toEqual(hello)
    expect(roundTrips(hostHelloFrameSchema, hello)).toEqual(hello)

    const run = {
      kind: 'run',
      key: 'run-1:call-1',
      epoch: 5,
      op: { op: 'exec', argv: ['ls'] },
    } as const
    expect(roundTrips(hostFrameSchema, run)).toEqual(run)
    expect(roundTrips(runFrameSchema, run)).toEqual(run)

    const ack = { kind: 'ack', key: 'run-1:call-1', epoch: 5 } as const
    expect(roundTrips(hostFrameSchema, ack)).toEqual(ack)
    expect(roundTrips(ackFrameSchema, ack)).toEqual(ack)

    const cancel = { kind: 'cancel', key: 'run-1:call-1', epoch: 5 } as const
    expect(roundTrips(hostFrameSchema, cancel)).toEqual(cancel)
    expect(roundTrips(hostFrameSchema, { kind: 'ping' })).toEqual({ kind: 'ping' })
  })

  it('rejects a hello without a token, a run carrying a bootId, and a collect frame', () => {
    expect(
      hostHelloFrameSchema.safeParse({ kind: 'hello', sessionId: 's-1', epoch: 5 }).success,
    ).toBe(false)
    expect(
      runFrameSchema.safeParse({
        kind: 'run',
        key: 'k',
        epoch: 1,
        bootId: 'boot-7',
        op: { op: 'stat', path: '/work' },
      }).success,
    ).toBe(false)
    expect(hostFrameSchema.safeParse({ kind: 'collect', key: 'k' }).success).toBe(false)
    expect(hostFrameSchema.safeParse({ kind: 'nope' }).success).toBe(false)
  })
})

describe('daemon to agent-host frames', () => {
  it('round-trips the hello reply with the bootId', () => {
    const reply = { kind: 'hello-reply', bootId: 'boot-7', version: '0.1.0' } as const
    expect(roundTrips(daemonFrameSchema, reply)).toEqual(reply)
    expect(roundTrips(helloReplyFrameSchema, reply)).toEqual(reply)
  })

  it('round-trips output, run-reply, result, health, error and pong', () => {
    const output = { kind: 'output', key: 'run-1:call-1', offset: 0, bytes: 'aGVsbG8=' } as const
    expect(roundTrips(daemonFrameSchema, output)).toEqual(output)
    expect(roundTrips(outputChunkFrameSchema, output)).toEqual(output)

    const running: RunReplyFrame = {
      kind: 'run-reply',
      key: 'run-1:call-1',
      state: ERunState.Running,
    }
    expect(roundTrips(daemonFrameSchema, running)).toEqual(running)
    expect(roundTrips(runReplyFrameSchema, running)).toEqual(running)

    const result: ResultFrame = {
      kind: 'result',
      key: 'run-1:call-1',
      result: {
        status: ECallStatus.Ok,
        op: 'exec',
        value: { exitCode: 0, signal: null, outcome: EExecOutcome.Exited, outputBytes: 4 },
      },
    }
    expect(roundTrips(daemonFrameSchema, result)).toEqual(result)
    expect(roundTrips(resultFrameSchema, result)).toEqual(result)

    const failed: ResultFrame = {
      kind: 'result',
      key: 'run-1:call-2',
      result: {
        status: ECallStatus.Failed,
        op: 'readFile',
        error: { code: ECallFailure.NotFound, message: 'ENOENT' },
      },
    }
    expect(roundTrips(resultFrameSchema, failed)).toEqual(failed)
    expect(
      resultFrameSchema.safeParse({
        kind: 'result',
        key: 'k',
        result: { status: ECallStatus.Ok, op: 'readFile', value: 42 },
      }).success,
    ).toBe(false)

    const health: HealthFrame = {
      kind: 'health',
      bootId: 'boot-7',
      version: '0.1.0',
      protection: {
        cgroups: { status: EProtection.Applied },
        oomScoreAdj: { status: EProtection.Failed, error: 'EACCES' },
      },
    }
    expect(roundTrips(daemonFrameSchema, health)).toEqual(health)
    expect(roundTrips(healthFrameSchema, health)).toEqual(health)

    const bootChanged = {
      kind: 'error',
      key: 'run-1:call-1',
      errorKind: EDaemonErrorKind.NotDone,
      message: 'still running',
    } as const
    expect(roundTrips(daemonFrameSchema, bootChanged)).toEqual(bootChanged)
    expect(roundTrips(daemonErrorFrameSchema, bootChanged)).toEqual(bootChanged)

    const staleEpoch = {
      kind: 'error',
      errorKind: EDaemonErrorKind.StaleEpoch,
      message: 'a newer holder connected',
    } as const
    expect(roundTrips(daemonFrameSchema, staleEpoch)).toEqual(staleEpoch)

    expect(roundTrips(daemonFrameSchema, { kind: 'pong', runs: 2 })).toEqual({
      kind: 'pong',
      runs: 2,
    })
    expect(roundTrips(daemonFrameSchema, { kind: 'acked', key: 'k' })).toEqual({
      kind: 'acked',
      key: 'k',
    })
    const oom: DaemonFrame = { kind: 'event', event: { type: 'exec.oom-kill', key: 'k' } }
    expect(roundTrips(daemonFrameSchema, oom)).toEqual(oom)
    expect(daemonFrameSchema.safeParse({ kind: 'event', event: { type: 'nope' } }).success).toBe(
      false,
    )
  })

  it('rejects an unknown error kind, a negative offset and non-base64 bytes', () => {
    expect(
      daemonErrorFrameSchema.safeParse({
        kind: 'error',
        errorKind: 'mystery',
        message: 'x',
      }).success,
    ).toBe(false)
    expect(
      outputChunkFrameSchema.safeParse({ kind: 'output', key: 'k', offset: -1, bytes: '' }).success,
    ).toBe(false)
    expect(
      outputChunkFrameSchema.safeParse({
        kind: 'output',
        key: 'k',
        offset: 0,
        bytes: 'not base64!',
      }).success,
    ).toBe(false)
  })
})

describe('session API inputs', () => {
  it('round-trips create, list, post, events and status inputs', () => {
    const create = { projectId: 'proj-1', title: 'a v2 session' }
    expect(roundTrips(sessionCreateInputSchema, create)).toEqual(create)

    const list = { projectId: 'proj-1', limit: 50 }
    expect(roundTrips(sessionListInputSchema, list)).toEqual(list)
    expect(roundTrips(sessionListInputSchema, {})).toEqual({})

    const post = { sessionId: 's-1', text: 'hello the agent host' }
    expect(roundTrips(sessionPostInputSchema, post)).toEqual(post)

    const events = { sessionId: 's-1', afterSeq: 41, limit: 1000 }
    expect(roundTrips(sessionEventsInputSchema, events)).toEqual(events)

    const status = { sessionId: 's-1' }
    expect(roundTrips(sessionStatusInputSchema, status)).toEqual(status)
  })

  it('rejects an empty text and an out-of-range events limit', () => {
    expect(sessionPostInputSchema.safeParse({ sessionId: 's-1', text: '' }).success).toBe(false)
    expect(sessionEventsInputSchema.safeParse({ sessionId: 's-1', limit: 1001 }).success).toBe(
      false,
    )
  })
})
