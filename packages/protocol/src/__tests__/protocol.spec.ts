import { describe, expect, it } from 'bun:test'

import {
  EDaemonErrorKind,
  ackFrameSchema,
  collectFrameSchema,
  daemonErrorFrameSchema,
  daemonFrameSchema,
  healthFrameSchema,
  hostFrameSchema,
  hostHelloFrameSchema,
  outputChunkFrameSchema,
  resultFrameSchema,
  runFrameSchema,
  v2SessionCreateInputSchema,
  v2SessionEventsInputSchema,
  v2SessionListInputSchema,
  v2SessionPostInputSchema,
  v2SessionStatusInputSchema,
} from '../index'

const roundTrips = <T>(schema: { parse: (value: unknown) => T }, value: unknown): T =>
  schema.parse(JSON.parse(JSON.stringify(value)))

describe('agent-host to daemon frames', () => {
  it('round-trips hello, run, collect, ack, cancel and ping', () => {
    const hello = { kind: 'hello', sessionId: 's-1', epoch: 5, token: 'tok' } as const
    expect(roundTrips(hostFrameSchema, hello)).toEqual(hello)
    expect(roundTrips(hostHelloFrameSchema, hello)).toEqual(hello)

    const run = {
      kind: 'run',
      key: 'run-1:call-1',
      bootId: 'boot-7',
      op: { tool: 'bash', input: { command: 'ls' } },
    } as const
    expect(roundTrips(hostFrameSchema, run)).toEqual(run)
    expect(roundTrips(runFrameSchema, run)).toEqual(run)

    const collect = { kind: 'collect', key: 'run-1:call-1', afterOffset: 128 } as const
    expect(roundTrips(hostFrameSchema, collect)).toEqual(collect)
    expect(roundTrips(collectFrameSchema, collect)).toEqual(collect)

    const ack = { kind: 'ack', key: 'run-1:call-1' } as const
    expect(roundTrips(hostFrameSchema, ack)).toEqual(ack)
    expect(roundTrips(ackFrameSchema, ack)).toEqual(ack)

    expect(roundTrips(hostFrameSchema, { kind: 'cancel', key: 'run-1:call-1' })).toEqual({
      kind: 'cancel',
      key: 'run-1:call-1',
    })
    expect(roundTrips(hostFrameSchema, { kind: 'ping' })).toEqual({ kind: 'ping' })
  })

  it('rejects a hello without a token and a run without a bootId', () => {
    expect(
      hostHelloFrameSchema.safeParse({ kind: 'hello', sessionId: 's-1', epoch: 5 }).success,
    ).toBe(false)
    expect(hostFrameSchema.safeParse({ kind: 'run', key: 'k', op: { tool: 'bash' } }).success).toBe(
      false,
    )
    expect(hostFrameSchema.safeParse({ kind: 'nope' }).success).toBe(false)
  })
})

describe('daemon to agent-host frames', () => {
  it('round-trips output, result, health, error and pong', () => {
    const output = { kind: 'output', key: 'run-1:call-1', offset: 0, bytes: 'aGVsbG8=' } as const
    expect(roundTrips(daemonFrameSchema, output)).toEqual(output)
    expect(roundTrips(outputChunkFrameSchema, output)).toEqual(output)

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

  it('rejects an unknown error kind and an output chunk with a negative offset', () => {
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
