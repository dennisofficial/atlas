import { describe, expect, it } from 'bun:test'
import { toRunId } from '@dltech/atlas-core'

import { ETurnStatus } from '../../loop/turn-outcome'
import { EClientFrame, EServeFrame } from '../channel-wire'
import { EChannelConnection } from '../remote-delta-channel'
import { RemoteTurnRunner } from '../remote-turn-runner'
import { harness, THREAD } from './remote-channel-fixture'

describe('preparing an attachment before an explicit resume check', () => {
  it('wakes a parked sandbox without sending or claiming a turn', async () => {
    const held = harness({ unattached: true })
    let wakes = 0
    const runner = new RemoteTurnRunner({
      channel: held.channel,
      wake: async () => {
        wakes += 1
        held.channel.wake({ url: 'https://sandbox.test/', token: 'tok_session' })
        held.open()
        held.receive({ kind: EServeFrame.Ready, seq: 1, turnInFlight: false })
      },
    })

    await runner.ensureAttached()
    expect(wakes).toBe(1)
    expect(held.channel.connection().state).toBe(EChannelConnection.Open)
    expect(runner.turnInFlight()).toBe(false)
    expect(held.live().sent.filter((frame) => frame.kind === EClientFrame.Run)).toEqual([])

    const resumed = runner.resume({ threadId: THREAD })
    expect(held.live().sent.at(-1)).toEqual({ kind: EClientFrame.Run, resume: true })
    held.receive({ kind: EServeFrame.TurnEnded, outcome: { status: ETurnStatus.Completed, runId: toRunId('resumed') } })
    await resumed
    expect(wakes).toBe(1)
  })

  it('leaves an already-open sandbox alone and preserves synchronous turn admission', async () => {
    const held = harness()
    held.open()
    held.receive({ kind: EServeFrame.Ready, seq: 1 })
    let wakes = 0
    const runner = new RemoteTurnRunner({ channel: held.channel, wake: async () => { wakes += 1 } })

    await runner.ensureAttached()
    expect(wakes).toBe(0)
    const turn = runner.runTurn({ threadId: THREAD })
    expect(held.live().sent.at(-1)).toEqual({ kind: EClientFrame.Run })
    held.receive({ kind: EServeFrame.TurnEnded, outcome: { status: ETurnStatus.Completed, runId: toRunId('running') } })
    await turn
  })

  it('reports a failed explicit wake without claiming a turn', async () => {
    const held = harness({ unattached: true })
    const runner = new RemoteTurnRunner({ channel: held.channel, wake: async () => { throw new Error('wake unavailable') } })

    await expect(runner.ensureAttached()).rejects.toThrow('wake unavailable')
    expect(runner.turnInFlight()).toBe(false)
    expect(held.sockets).toEqual([])
  })
})
