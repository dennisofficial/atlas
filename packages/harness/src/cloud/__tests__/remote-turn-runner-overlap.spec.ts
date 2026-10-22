import { describe, expect, it } from 'bun:test'

import { toRunId } from '@dltech/atlas-core'

import { ETurnStatus } from '../../loop/turn-outcome'
import { EClientFrame, EServeFrame } from '../channel-wire'
import { RemoteTurnRunner } from '../remote-turn-runner'

import { readied, THREAD } from './remote-channel-fixture'

const completed = (runId: string) =>
  ({ status: ETurnStatus.Completed, runId: toRunId(runId) }) as const

const runFrames = (attached: ReturnType<typeof readied>) =>
  attached.live().sent.filter((frame) => frame.kind === EClientFrame.Run)

const gate = () => {
  let open = (): void => undefined
  let fail = (_error: Error): void => undefined
  const opened = new Promise<void>((resolve, reject) => {
    open = resolve
    fail = reject
  })
  return { opened, open: () => open(), fail: (error: Error) => fail(error) }
}

describe('overlapping explicit runs on one runner', () => {
  it('refuses a resume while a run is accepted and leaves the accepted run waiting for its own outcome', async () => {
    const attached = readied()
    const runner = new RemoteTurnRunner({ channel: attached.channel, wake: async () => undefined })

    const accepted = runner.runTurn({ threadId: THREAD })
    await expect(runner.resume({ threadId: THREAD })).rejects.toThrow('already')

    expect(runFrames(attached)).toEqual([{ kind: EClientFrame.Run }])

    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-1') })
    await expect(accepted).resolves.toEqual(completed('run-1'))
  })

  it('refuses a second run as well, without sending a frame', async () => {
    const attached = readied()
    const runner = new RemoteTurnRunner({ channel: attached.channel, wake: async () => undefined })

    const accepted = runner.runTurn({ threadId: THREAD })
    await expect(runner.runTurn({ threadId: THREAD })).rejects.toThrow('already')
    expect(runFrames(attached)).toHaveLength(1)

    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-1') })
    await accepted
  })

  it('refuses a resume while a say is waiting on its turn', async () => {
    const attached = readied()
    const runner = new RemoteTurnRunner({ channel: attached.channel, wake: async () => undefined })

    const said = runner.say({ threadId: THREAD, text: 'go' })
    await expect(runner.resume({ threadId: THREAD })).rejects.toThrow('already')
    expect(runFrames(attached)).toHaveLength(0)

    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-1') })
    await expect(said).resolves.toEqual(completed('run-1'))
  })

  it('refuses a resume that arrives while the first run is still waiting for the sandbox to wake', async () => {
    const attached = readied()
    attached.receive({ kind: EServeFrame.Parked, reason: 'idle' })
    const waking = gate()
    const runner = new RemoteTurnRunner({ channel: attached.channel, wake: () => waking.opened })

    const accepted = runner.runTurn({ threadId: THREAD })
    await expect(runner.resume({ threadId: THREAD })).rejects.toThrow('already')
    await expect(runner.runTurn({ threadId: THREAD })).rejects.toThrow('already')

    waking.open()
    await Bun.sleep(1)
    expect(runFrames(attached).every((frame) => frame.resume !== true)).toBe(true)

    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-1') })
    await expect(accepted).resolves.toEqual(completed('run-1'))
  })

  it('releases its claim when the wake fails, so the next run is accepted', async () => {
    const attached = readied()
    attached.receive({ kind: EServeFrame.Parked, reason: 'idle' })
    const waking = gate()
    let wakes = 0
    const runner = new RemoteTurnRunner({
      channel: attached.channel,
      wake: () => {
        wakes += 1
        return wakes === 1 ? waking.opened : Promise.resolve()
      },
    })

    const failing = runner.runTurn({ threadId: THREAD })
    waking.fail(new Error('the sandbox would not wake'))
    await expect(failing).rejects.toThrow('would not wake')

    const next = runner.resume({ threadId: THREAD })
    await Bun.sleep(1)
    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-2') })
    await expect(next).resolves.toEqual(completed('run-2'))
  })

  it('accepts a resume once the previous run has settled', async () => {
    const attached = readied()
    const runner = new RemoteTurnRunner({ channel: attached.channel, wake: async () => undefined })

    const first = runner.runTurn({ threadId: THREAD })
    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-1') })
    await first

    const second = runner.resume({ threadId: THREAD })
    expect(runFrames(attached).at(-1)).toEqual({ kind: EClientFrame.Run, resume: true })
    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-2') })
    await expect(second).resolves.toEqual(completed('run-2'))
  })

  it('keeps steering a running turn available', async () => {
    const attached = readied()
    const runner = new RemoteTurnRunner({ channel: attached.channel, wake: async () => undefined })

    const accepted = runner.runTurn({ threadId: THREAD })
    runner.steer({ threadId: THREAD, text: 'also this' })

    expect(attached.live().sent.at(-1)).toMatchObject({ kind: EClientFrame.Send, text: 'also this' })
    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-1') })
    await accepted
  })
})
