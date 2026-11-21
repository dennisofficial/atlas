import { describe, expect, it } from 'bun:test'

import { EPodSleepOutcome } from './pod-sleep.contract'
import { runPodSleep, type PodSleepPower, type PodSleepSession } from './pod-sleep-run'

const SESSION: PodSleepSession = {
  sessionId: 'ses-1',
  podSessionId: 'pod-1',
  mainThreadId: 'thr-1',
}

type Run = {
  session?: PodSleepSession | undefined
  power?: readonly PodSleepPower[]
  busy?: readonly boolean[]
}

const runOf = async (args: Run) => {
  const slept: string[] = []
  const released: { sessionId: string; epoch: number }[] = []
  const powers = [...(args.power ?? [{ epoch: 3, wantsHolder: false, live: false }])]
  const busyStates = [...(args.busy ?? [false])]
  const powerNext = (): PodSleepPower =>
    powers.length > 1 ? (powers.shift() as PodSleepPower) : (powers[0] as PodSleepPower)
  const busyNext = (): boolean =>
    busyStates.length > 1 ? (busyStates.shift() as boolean) : (busyStates[0] as boolean)
  const output = await runPodSleep({
    payload: { sessionId: 'ses-1', epoch: 3 },
    deps: {
      session: async () => ('session' in args ? args.session : SESSION),
      power: async () => powerNext(),
      busy: async () => busyNext(),
      release: async (release) => {
        released.push(release)
      },
      sleep: async ({ sandboxSessionId }) => {
        slept.push(sandboxSessionId)
      },
      wait: async () => undefined,
    },
  })
  return { output, slept, released }
}

describe('runPodSleep', () => {
  it('sleeps the pod the session row points at', async () => {
    const { output, slept, released } = await runOf({})

    expect(output).toEqual({ outcome: EPodSleepOutcome.Slept })
    expect(slept).toEqual(['pod-1'])
    expect(released).toEqual([{ sessionId: 'ses-1', epoch: 3 }])
  })

  it('sleeps the session itself when it never rolled to another pod', async () => {
    const { slept } = await runOf({
      session: { ...SESSION, podSessionId: null },
    })

    expect(slept).toEqual(['ses-1'])
  })

  it('does nothing when the session is gone', async () => {
    const { output, slept } = await runOf({ session: undefined })

    expect(output).toEqual({ outcome: EPodSleepOutcome.Absent })
    expect(slept).toEqual([])
  })

  it('waits for the stopped turn to end before it sleeps the pod', async () => {
    const { output, slept, released } = await runOf({ busy: [true, true, false] })

    expect(output).toEqual({ outcome: EPodSleepOutcome.Slept })
    expect(released).toEqual([{ sessionId: 'ses-1', epoch: 3 }])
    expect(slept).toEqual(['pod-1'])
  })

  it('leaves the pod alone when the turn never ends', async () => {
    const { output, slept, released } = await runOf({ busy: [true] })

    expect(output).toEqual({ outcome: EPodSleepOutcome.Superseded })
    expect(released).toEqual([])
    expect(slept).toEqual([])
  })

  it('does nothing when the pod was woken before the job ran', async () => {
    const { output, slept } = await runOf({
      power: [{ epoch: 4, wantsHolder: true, live: false }],
    })

    expect(output).toEqual({ outcome: EPodSleepOutcome.Superseded })
    expect(slept).toEqual([])
  })

  it('does nothing when a wake lands while the stopped turn ends', async () => {
    const { output, slept, released } = await runOf({
      busy: [true, false],
      power: [{ epoch: 3, wantsHolder: true, live: false }],
    })

    expect(output).toEqual({ outcome: EPodSleepOutcome.Superseded })
    expect(released).toEqual([])
    expect(slept).toEqual([])
  })

  it('does nothing when another host claimed the pod', async () => {
    const { output, slept } = await runOf({
      power: [{ epoch: 4, wantsHolder: false, live: true }],
    })

    expect(output).toEqual({ outcome: EPodSleepOutcome.Superseded })
    expect(slept).toEqual([])
  })

  it('finishes a sleep a retry found already released, so a crashed attempt still sleeps the pod', async () => {
    const { output, slept } = await runOf({
      power: [{ epoch: 4, wantsHolder: false, live: false }],
    })

    expect(output).toEqual({ outcome: EPodSleepOutcome.Slept })
    expect(slept).toEqual(['pod-1'])
  })
})
