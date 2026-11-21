import { describe, expect, it } from 'bun:test'

import { EPodSleepOutcome } from './pod-sleep.contract'
import { runPodSleep, type PodSleepSession } from './pod-sleep-run'

const runOf = async (args: { session: PodSleepSession | undefined }) => {
  const slept: string[] = []
  const output = await runPodSleep({
    payload: { sessionId: 'ses-1', epoch: 3 },
    deps: {
      session: async () => args.session,
      sleep: async ({ sandboxSessionId }) => {
        slept.push(sandboxSessionId)
      },
    },
  })
  return { output, slept }
}

describe('runPodSleep', () => {
  it('sleeps the pod the session row points at', async () => {
    const { output, slept } = await runOf({
      session: { sessionId: 'ses-1', podSessionId: 'pod-1' },
    })

    expect(output).toEqual({ outcome: EPodSleepOutcome.Slept })
    expect(slept).toEqual(['pod-1'])
  })

  it('sleeps the session itself when it never rolled to another pod', async () => {
    const { slept } = await runOf({ session: { sessionId: 'ses-1', podSessionId: null } })

    expect(slept).toEqual(['ses-1'])
  })

  it('does nothing when the session is gone', async () => {
    const { output, slept } = await runOf({ session: undefined })

    expect(output).toEqual({ outcome: EPodSleepOutcome.Absent })
    expect(slept).toEqual([])
  })
})
