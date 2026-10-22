import { describe, expect, it } from 'bun:test'

import { toRunId } from '@dltech/atlas-core'

import { ETurnStatus } from '../../loop/turn-outcome'
import { EClientFrame, EServeFrame } from '../channel-wire'
import { RemoteTurnRunner } from '../remote-turn-runner'

import { readied, THREAD } from './remote-channel-fixture'

const completed = (runId: string) =>
  ({ status: ETurnStatus.Completed, runId: toRunId(runId) }) as const

describe('resume intent over the run frame', () => {
  it('sends a bare run frame with no resume key when the channel runs without arguments', () => {
    const attached = readied()

    attached.channel.run()

    const sent = attached.live().sent.at(-1)
    expect(sent).toEqual({ kind: EClientFrame.Run })
    expect(sent !== undefined && 'resume' in sent).toBe(false)
  })

  it('stamps resume on the run frame only when it is true', () => {
    const attached = readied()

    attached.channel.run({ resume: true })
    expect(attached.live().sent.at(-1)).toEqual({ kind: EClientFrame.Run, resume: true })

    attached.channel.run({ resume: false })
    const sent = attached.live().sent.at(-1)
    expect(sent).toEqual({ kind: EClientFrame.Run })
    expect(sent !== undefined && 'resume' in sent).toBe(false)
  })

  it('maps runner.resume to a resume run frame and settles with the sandbox outcome', async () => {
    const attached = readied()
    const runner = new RemoteTurnRunner({ channel: attached.channel, wake: async () => undefined })

    const turn = runner.resume({ threadId: THREAD })
    expect(attached.live().sent.at(-1)).toEqual({ kind: EClientFrame.Run, resume: true })

    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-1') })
    await expect(turn).resolves.toEqual(completed('run-1'))
  })

  it('keeps runner.runTurn a bare run frame', async () => {
    const attached = readied()
    const runner = new RemoteTurnRunner({ channel: attached.channel, wake: async () => undefined })

    const turn = runner.runTurn({ threadId: THREAD })
    const sent = attached.live().sent.at(-1)
    expect(sent).toEqual({ kind: EClientFrame.Run })
    expect(sent !== undefined && 'resume' in sent).toBe(false)

    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-2') })
    await turn
  })

  it('still ignores a replayed outcome after a resumed turn settled', async () => {
    const attached = readied()
    const runner = new RemoteTurnRunner({ channel: attached.channel, wake: async () => undefined })

    const first = runner.resume({ threadId: THREAD })
    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-3') })
    await first

    const second = runner.runTurn({ threadId: THREAD })
    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-3') })
    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-4') })
    await expect(second).resolves.toEqual(completed('run-4'))
  })
})

describe('the held working state across a reconnect', () => {
  const working = { kind: EServeFrame.Signal, seq: 2, signal: { type: 'turn-working', working: true } } as const

  it('holds busy for a late subscriber while the sandbox reports a turn in flight', () => {
    const attached = readied()
    attached.receive({ kind: EServeFrame.Ready, seq: 2, turnInFlight: true })

    expect(attached.channel.snapshot({ threadId: THREAD })).toEqual([
      { type: 'turn-working', working: true },
    ])
  })

  it('drops a stale busy snapshot when a re-greet reports no turn in flight', () => {
    const attached = readied()
    attached.receive(working)
    expect(attached.channel.snapshot({ threadId: THREAD })).toHaveLength(1)

    attached.drop()
    attached.retries.at(-1)?.run()
    attached.open()
    attached.receive({ kind: EServeFrame.Reload, sinceEventSeq: 0 })
    attached.receive({ kind: EServeFrame.Ready, seq: 3, turnInFlight: false })

    expect(attached.channel.snapshot({ threadId: THREAD })).toEqual([])
    const seen: string[] = []
    attached.channel.subscribe({ threadId: THREAD, listener: (signal) => void seen.push(signal.type) })
    expect(seen).toEqual([])
  })
})
