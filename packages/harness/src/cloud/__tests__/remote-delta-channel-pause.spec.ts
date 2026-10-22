import { describe, expect, it } from 'bun:test'

import { toRunId } from '@dltech/atlas-core'

import { PauseSignal } from '../../loop/pause-signal'
import { ETurnStatus } from '../../loop/turn-outcome'
import { EClientFrame, EServeFrame } from '../channel-wire'
import { RemoteTurnRunner } from '../remote-turn-runner'

import { readied, THREAD } from './remote-channel-fixture'

describe('pausing the sandbox turn over the session socket', () => {
  it('sends a pause frame, the sibling of interrupt', () => {
    const attached = readied()

    attached.channel.pause()

    expect(attached.live().sent.at(-1)).toEqual({ kind: EClientFrame.Pause })
  })

  it('sends a resume frame, so a pre-commit abort can unfreeze what it paused', () => {
    const attached = readied()

    attached.channel.resume()

    expect(attached.live().sent.at(-1)).toEqual({ kind: EClientFrame.Resume })
  })

  it('maps a relocation pause on the runner to the pause frame, as abort maps to interrupt', async () => {
    const attached = readied()
    const runner = new RemoteTurnRunner({ channel: attached.channel, wake: async () => undefined })
    const pause = new PauseSignal()

    const turn = runner.runTurn({ threadId: THREAD, pause })
    pause.pause()

    expect(attached.live().sent.at(-1)).toEqual({ kind: EClientFrame.Pause })

    attached.receive({
      kind: EServeFrame.TurnEnded,
      outcome: { status: ETurnStatus.RelocationPaused, runId: toRunId('run-1') },
    })
    await expect(turn).resolves.toMatchObject({ status: ETurnStatus.RelocationPaused })
  })

  it('sends the pause frame even when the signal was paused before the turn fired', async () => {
    const attached = readied()
    const runner = new RemoteTurnRunner({ channel: attached.channel, wake: async () => undefined })
    const pause = new PauseSignal()
    pause.pause()

    const turn = runner.runTurn({ threadId: THREAD, pause })

    expect(attached.live().sent).toContainEqual({ kind: EClientFrame.Pause })

    attached.receive({
      kind: EServeFrame.TurnEnded,
      outcome: { status: ETurnStatus.RelocationPaused, runId: toRunId('run-1') },
    })
    await expect(turn).resolves.toMatchObject({ status: ETurnStatus.RelocationPaused })
  })

  it('pauses nothing once the turn settled, however late the signal fires', async () => {
    const attached = readied()
    const runner = new RemoteTurnRunner({ channel: attached.channel, wake: async () => undefined })
    const pause = new PauseSignal()

    const turn = runner.runTurn({ threadId: THREAD, pause })
    attached.receive({
      kind: EServeFrame.TurnEnded,
      outcome: { status: ETurnStatus.Completed, runId: toRunId('run-1') },
    })
    await expect(turn).resolves.toMatchObject({ status: ETurnStatus.Completed })

    const sentBefore = attached.live().sent.length
    pause.pause()
    expect(attached.live().sent).toHaveLength(sentBefore)
  })
})
