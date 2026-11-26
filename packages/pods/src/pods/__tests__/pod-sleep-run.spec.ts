import { describe, expect, it } from 'bun:test'

import { EPodSleepOutcome } from '@dltech/atlas-jobs/pod-sleep'
import {
  runPodSleep,
  SESSION_KEPT,
  TURN_NEVER_ENDED,
  type PodSleepPower,
  type PodSleepSession,
} from '../pod-sleep-run'

const PARKED_AT = '2026-11-26T10:00:00.000Z'

const SESSION: PodSleepSession = {
  sessionId: 'ses-1',
  podSessionId: 'pod-1',
  mainThreadId: 'thr-1',
  archivedAt: null,
}

type Run = {
  session?: PodSleepSession | undefined
  powers?: readonly PodSleepPower[]
  turnRunning?: readonly boolean[]
  parked?: readonly (string | null)[]
  releases?: readonly boolean[]
  sleepFails?: string | undefined
  parkedAt?: string | undefined
}

const next = <T>(list: readonly T[], fallback: T): (() => T) => {
  let index = 0
  return () => {
    const value = list[Math.min(index, Math.max(list.length - 1, 0))]
    index += 1
    return value === undefined ? fallback : value
  }
}

const runOf = async (args: Run) => {
  const slept: string[] = []
  const released: { sessionId: string; epoch: number }[] = []
  const written: { sessionId: string; parkedAt: string; error: string }[] = []
  const waits: number[] = []
  const power = next(args.powers ?? [{ epoch: 3, wantsHolder: false, live: false }], {
    epoch: 3,
    wantsHolder: false,
    live: false,
  })
  const turnRunning = next(args.turnRunning ?? [false], false)
  const parked = next<string | null>(args.parked ?? [PARKED_AT], PARKED_AT)
  const release = next(args.releases ?? [true], true)
  const output = await runPodSleep({
    payload: {
      sessionId: 'ses-1',
      epoch: 3,
      ...(args.parkedAt === undefined ? { parkedAt: PARKED_AT } : { parkedAt: args.parkedAt }),
    },
    deps: {
      session: async () => ('session' in args ? args.session : SESSION),
      power: async () => power(),
      parked: async () => ({ parkedAt: parked() }),
      turnRunning: async () => turnRunning(),
      failPark: async (write) => {
        written.push(write)
        return true
      },
      release: async (request) => {
        released.push(request)
        return release()
      },
      sleep: async ({ sandboxSessionId }) => {
        if (args.sleepFails !== undefined) throw new Error(args.sleepFails)
        slept.push(sandboxSessionId)
      },
      wait: async ({ ms }) => {
        waits.push(ms)
      },
    },
  })
  return { output, slept, released, written, waits }
}

describe('runPodSleep', () => {
  it('sleeps an idle pod and releases its lease first', async () => {
    const { output, slept, released } = await runOf({})

    expect(output).toEqual({ outcome: EPodSleepOutcome.Slept })
    expect(released).toEqual([{ sessionId: 'ses-1', epoch: 3 }])
    expect(slept).toEqual(['pod-1'])
  })

  it('sleeps the session itself when it never rolled to another pod', async () => {
    const { slept } = await runOf({ session: { ...SESSION, podSessionId: null } })

    expect(slept).toEqual(['ses-1'])
  })

  it('sleeps a pod whose only work is a service', async () => {
    const { output, slept } = await runOf({ turnRunning: [false] })

    expect(output).toEqual({ outcome: EPodSleepOutcome.Slept })
    expect(slept).toEqual(['pod-1'])
  })

  it('waits for a holder to hand the session back, then sleeps the pod', async () => {
    const { output, slept, waits } = await runOf({
      powers: [
        { epoch: 3, wantsHolder: false, live: true },
        { epoch: 3, wantsHolder: false, live: false },
      ],
    })

    expect(output).toEqual({ outcome: EPodSleepOutcome.Slept })
    expect(waits).toHaveLength(1)
    expect(slept).toEqual(['pod-1'])
  })

  it('waits for a running turn to end, then sleeps the pod', async () => {
    const { output, slept, written } = await runOf({
      turnRunning: [true, true, false],
      powers: [
        { epoch: 3, wantsHolder: false, live: true },
        { epoch: 3, wantsHolder: false, live: true },
        { epoch: 3, wantsHolder: false, live: false },
      ],
    })

    expect(output).toEqual({ outcome: EPodSleepOutcome.Slept })
    expect(written).toEqual([])
    expect(slept).toEqual(['pod-1'])
  })

  it('revokes a holder that never hands the session back, then sleeps the pod', async () => {
    const { output, slept, released } = await runOf({
      powers: [{ epoch: 4, wantsHolder: false, live: true }],
    })

    expect(output).toEqual({ outcome: EPodSleepOutcome.Slept })
    expect(released).toEqual([{ sessionId: 'ses-1', epoch: 4 }])
    expect(slept).toEqual(['pod-1'])
  })

  it('fails loudly when the turn never ends', async () => {
    const { output, slept, written } = await runOf({
      turnRunning: [true],
      powers: [{ epoch: 3, wantsHolder: false, live: true }],
    })

    expect(output).toEqual({ outcome: EPodSleepOutcome.Failed })
    expect(written).toEqual([{ sessionId: 'ses-1', parkedAt: PARKED_AT, error: TURN_NEVER_ENDED }])
    expect(slept).toEqual([])
  })

  it('fails loudly when another host keeps the session', async () => {
    const { output, slept, written } = await runOf({ releases: [false] })

    expect(output).toEqual({ outcome: EPodSleepOutcome.Failed })
    expect(written).toEqual([{ sessionId: 'ses-1', parkedAt: PARKED_AT, error: SESSION_KEPT }])
    expect(slept).toEqual([])
  })

  it('retries a revoke once before it gives up', async () => {
    const { output, slept, released } = await runOf({
      releases: [false, true],
      powers: [{ epoch: 3, wantsHolder: false, live: true }],
    })

    expect(output).toEqual({ outcome: EPodSleepOutcome.Slept })
    expect(released).toEqual([
      { sessionId: 'ses-1', epoch: 3 },
      { sessionId: 'ses-1', epoch: 3 },
    ])
    expect(slept).toEqual(['pod-1'])
  })

  it('does nothing when the session is gone', async () => {
    const { output, slept } = await runOf({ session: undefined })

    expect(output).toEqual({ outcome: EPodSleepOutcome.Absent })
    expect(slept).toEqual([])
  })

  it('does nothing when a newer stop replaced this park', async () => {
    const { output, slept } = await runOf({ parked: ['2026-11-26T11:00:00.000Z'] })

    expect(output).toEqual({ outcome: EPodSleepOutcome.Superseded })
    expect(slept).toEqual([])
  })

  it('does nothing when the park was cleared while it waited for the turn', async () => {
    const { output, slept } = await runOf({
      turnRunning: [true, false],
      powers: [{ epoch: 3, wantsHolder: false, live: true }],
      parked: [PARKED_AT, PARKED_AT, null],
    })

    expect(output).toEqual({ outcome: EPodSleepOutcome.Superseded })
    expect(slept).toEqual([])
  })

  it('does nothing when a message woke the pod right after the release', async () => {
    const { output, slept, released } = await runOf({ parked: [PARKED_AT, null] })

    expect(output).toEqual({ outcome: EPodSleepOutcome.Superseded })
    expect(released).toEqual([{ sessionId: 'ses-1', epoch: 3 }])
    expect(slept).toEqual([])
  })

  it('writes the provider failure to the row instead of retrying silently', async () => {
    const { output, slept, written } = await runOf({ sleepFails: 'agent37 said no' })

    expect(output).toEqual({ outcome: EPodSleepOutcome.Failed })
    expect(written).toEqual([{ sessionId: 'ses-1', parkedAt: PARKED_AT, error: 'agent37 said no' }])
    expect(slept).toEqual([])
  })

  it('sleeps an archived pod that a resize asked to wake, since nothing claims it', async () => {
    const { output, slept } = await runOf({
      session: { ...SESSION, archivedAt: '2026-11-23T01:43:02.832Z' },
      parkedAt: undefined,
      powers: [{ epoch: 3, wantsHolder: true, live: false }],
    })

    expect(output).toEqual({ outcome: EPodSleepOutcome.Slept })
    expect(slept).toEqual(['pod-1'])
  })

  it('sleeps an archived pod without waiting for a turn the archive took off its holder', async () => {
    const { output, slept, waits } = await runOf({
      session: { ...SESSION, archivedAt: '2026-11-23T01:43:02.832Z' },
      parkedAt: undefined,
      turnRunning: [true],
    })

    expect(output).toEqual({ outcome: EPodSleepOutcome.Slept })
    expect(waits).toEqual([])
    expect(slept).toEqual(['pod-1'])
  })
})
