import { describe, expect, it } from 'bun:test'

import { toRunId } from '@dltech/atlas-core'

import { ETurnStatus, type TurnOutcome } from '../../loop/turn-outcome'
import { EClientFrame, EServeFrame } from '../channel-wire'
import { RemoteTurnRunner, SERVE_DEFAULT_REPLAY_WINDOW_OUTCOMES } from '../remote-turn-runner'

import { harness, readied, THREAD } from './remote-channel-fixture'

const completed = (runId: string): TurnOutcome => ({
  status: ETurnStatus.Completed,
  runId: toRunId(runId),
})

const settledState = (turn: Promise<TurnOutcome>) => {
  const state = { settled: false }
  const mark = () => void (state.settled = true)
  void turn.then(mark, mark)
  return state
}

const reconnect = (attached: ReturnType<typeof harness>) => {
  attached.drop()
  attached.retries[0]?.run()
  attached.retries.splice(0, attached.retries.length)
  attached.open()
  attached.receive({ kind: EServeFrame.Ready, seq: 2 })
}

describe('a turn waiting across a reconnect that replays an outcome already seen', () => {
  it('does not settle a run queued while disconnected with the replayed old end', async () => {
    const attached = readied()
    const runner = new RemoteTurnRunner({ channel: attached.channel, wake: async () => undefined })

    const first = runner.runTurn({ threadId: THREAD })
    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-1') })
    await expect(first).resolves.toEqual(completed('run-1'))

    attached.drop()
    const second = runner.runTurn({ threadId: THREAD })
    const state = settledState(second)
    attached.retries[0]?.run()
    attached.open()
    attached.receive({ kind: EServeFrame.Ready, seq: 2 })
    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-1') })
    await Bun.sleep(1)

    expect(state.settled).toBe(false)
    expect(attached.live().sent.filter((frame) => frame.kind === EClientFrame.Run)).toHaveLength(1)

    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-2') })
    await expect(second).resolves.toEqual(completed('run-2'))
  })

  it('does the same for a queued say, whose send is flushed ahead of the replay', async () => {
    const attached = readied()
    const runner = new RemoteTurnRunner({ channel: attached.channel, wake: async () => undefined })

    const first = runner.runTurn({ threadId: THREAD })
    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-1') })
    await first

    attached.drop()
    const second = runner.say({ threadId: THREAD, text: 'and then this' })
    const state = settledState(second)
    attached.retries[0]?.run()
    attached.open()
    attached.receive({ kind: EServeFrame.Ready, seq: 2 })

    expect(attached.live().sent.at(-1)).toMatchObject({
      kind: EClientFrame.Send,
      text: 'and then this',
    })

    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-1') })
    await Bun.sleep(1)
    expect(state.settled).toBe(false)

    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-2') })
    await expect(second).resolves.toEqual(completed('run-2'))
  })

  it('settles one waiter per outcome when the same end arrives twice', async () => {
    const attached = readied()
    const runner = new RemoteTurnRunner({ channel: attached.channel, wake: async () => undefined })

    const first = runner.runTurn({ threadId: THREAD })
    const second = runner.runTurn({ threadId: THREAD })
    const state = settledState(second)

    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-1') })
    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-1') })
    await expect(first).resolves.toEqual(completed('run-1'))
    await Bun.sleep(1)
    expect(state.settled).toBe(false)

    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-2') })
    await expect(second).resolves.toEqual(completed('run-2'))
  })

  it('still settles the waiter with an end it missed while disconnected', async () => {
    const attached = readied()
    const runner = new RemoteTurnRunner({ channel: attached.channel, wake: async () => undefined })

    const turn = runner.runTurn({ threadId: THREAD })
    reconnect(attached)
    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-1') })

    await expect(turn).resolves.toEqual(completed('run-1'))
  })

  it('keeps ignoring the oldest replayed end after hundreds of later outcomes', async () => {
    const attached = readied()
    const runner = new RemoteTurnRunner({ channel: attached.channel, wake: async () => undefined })

    for (let index = 1; index <= 300; index += 1) {
      const turn = runner.runTurn({ threadId: THREAD })
      attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed(`run-${index}`) })
      await turn
    }

    const waiting = runner.runTurn({ threadId: THREAD })
    const state = settledState(waiting)
    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-1') })
    await Bun.sleep(1)
    expect(state.settled).toBe(false)

    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-301') })
    await expect(waiting).resolves.toEqual(completed('run-301'))
  })

  it('tracks the serve default replay window and forgets only what has fallen out of it', async () => {
    const attached = readied()
    const runner = new RemoteTurnRunner({ channel: attached.channel, wake: async () => undefined })
    const total = SERVE_DEFAULT_REPLAY_WINDOW_OUTCOMES + 5

    for (let index = 1; index <= total; index += 1) {
      const turn = runner.runTurn({ threadId: THREAD })
      attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed(`run-${index}`) })
      await turn
    }

    const waiting = runner.runTurn({ threadId: THREAD })
    const state = settledState(waiting)
    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-10') })
    await Bun.sleep(1)
    expect(state.settled).toBe(false)

    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-1') })
    await expect(waiting).resolves.toEqual(completed('run-1'))
  })
})
