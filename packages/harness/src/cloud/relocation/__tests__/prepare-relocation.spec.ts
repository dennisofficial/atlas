import { describe, expect, it } from 'bun:test'
import { toRunId } from '@dltech/atlas-core'
import { ETurnStatus, type TurnOutcome } from '../../../loop/turn-outcome'
import { prepareRelocation } from '../prepare-relocation'

const fixture = () => {
  const listeners = new Set<(outcome: TurnOutcome) => void>()
  let requested = 0
  const args = {
    onTurnEnded: (listener: (outcome: TurnOutcome) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    pause: () => { requested += 1 },
  }
  return { args, listeners, requested: () => requested, emit: (outcome: TurnOutcome) => {
    for (const listener of [...listeners]) listener(outcome)
  } }
}

describe('relocation confirmation', () => {
  it('requires the family pause acknowledgment rather than arbitrary settlement', async () => {
    const test = fixture()
    let confirmed = false
    const preparing = prepareRelocation(test.args).then(() => { confirmed = true })
    expect(test.requested()).toBe(1)
    test.emit({ status: ETurnStatus.Completed, runId: toRunId('completed') })
    await Promise.resolve()
    expect(confirmed).toBe(false)
    test.emit({ status: ETurnStatus.RelocationPaused, runId: toRunId('paused') })
    await preparing
    expect(confirmed).toBe(true)
    expect(test.listeners.size).toBe(0)
  })
  it('rejects its deadline without authorizing a move and unsubscribes', async () => {
    const test = fixture()
    await expect(prepareRelocation({ ...test.args, deadlineMs: 2 })).rejects.toThrow('nothing moved')
    expect(test.listeners.size).toBe(0)
  })
  it('rejects a failed preparation request and does not leak its subscription', async () => {
    const test = fixture()
    await expect(prepareRelocation({ ...test.args, pause: () => { throw new Error('unavailable') } })).rejects.toThrow('unavailable')
    expect(test.listeners.size).toBe(0)
  })
})
