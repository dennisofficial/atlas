import { describe, expect, it } from 'bun:test'

import {
  EDaemonErrorKind,
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
  v2SessionCreateInputSchema,
  v2SessionEventsInputSchema,
  v2SessionListInputSchema,
  v2SessionPostInputSchema,
  v2SessionStatusInputSchema,
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

    const running = { kind: 'run-reply', key: 'run-1:call-1', state: 'running' } as const
    expect(roundTrips(daemonFrameSchema, running)).toEqual(running)
    expect(roundTrips(runReplyFrameSchema, running)).toEqual(running)

    const result = {
      kind: 'result',
      key: 'run-1:call-1',
      result: { exitCode: 0, output: 'done' },
    } as const
    expect(roundTrips(daemonFrameSchema, result)).toEqual(result)
    expect(roundTrips(resultFrameSchema, result)).toEqual(result)

    const health = { kind: 'health', bootId: 'boot-7', version: '0.1.0' } as const
    expect(roundTrips(daemonFrameSchema, health)).toEqual(health)
    expect(roundTrips(healthFrameSchema, health)).toEqual(health)

    const bootChanged = {
      kind: 'error',
      key: 'run-1:call-1',
      errorKind: EDaemonErrorKind.BootChanged,
      message: 'the sandbox restarted',
    } as const
    expect(roundTrips(daemonFrameSchema, bootChanged)).toEqual(bootChanged)
    expect(roundTrips(daemonErrorFrameSchema, bootChanged)).toEqual(bootChanged)

    const staleEpoch = {
      kind: 'error',
      errorKind: EDaemonErrorKind.StaleEpoch,
      message: 'a newer holder connected',
    } as const
    expect(roundTrips(daemonFrameSchema, staleEpoch)).toEqual(staleEpoch)

    expect(roundTrips(daemonFrameSchema, { kind: 'pong' })).toEqual({ kind: 'pong' })
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

describe('v2 API inputs', () => {
  it('round-trips create, list, post, events and status inputs', () => {
    const create = { projectId: 'proj-1', title: 'a v2 session' }
    expect(roundTrips(v2SessionCreateInputSchema, create)).toEqual(create)

    const list = { projectId: 'proj-1', limit: 50 }
    expect(roundTrips(v2SessionListInputSchema, list)).toEqual(list)
    expect(roundTrips(v2SessionListInputSchema, {})).toEqual({})

    const post = { sessionId: 's-1', text: 'hello the agent host' }
    expect(roundTrips(v2SessionPostInputSchema, post)).toEqual(post)

    const events = { sessionId: 's-1', afterSeq: 41, limit: 1000 }
    expect(roundTrips(v2SessionEventsInputSchema, events)).toEqual(events)

    const status = { sessionId: 's-1' }
    expect(roundTrips(v2SessionStatusInputSchema, status)).toEqual(status)
  })

  it('rejects an empty text and an out-of-range events limit', () => {
    expect(v2SessionPostInputSchema.safeParse({ sessionId: 's-1', text: '' }).success).toBe(false)
    expect(v2SessionEventsInputSchema.safeParse({ sessionId: 's-1', limit: 1001 }).success).toBe(
      false,
    )
  })
})
