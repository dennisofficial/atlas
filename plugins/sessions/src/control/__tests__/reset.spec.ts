import { describe, expect, it } from 'bun:test'

import { resetPeerBudget, sessionsControl } from '..'

const planeOf = (reset: boolean) => {
  const calls: string[] = []
  return {
    calls,
    plane: {
      resetPeerBudget: async ({ sessionId }: { sessionId: string }) => {
        calls.push(sessionId)
        return reset
      },
    },
  }
}

describe('the sessions control slot', () => {
  it('registers reset-peer-budget and no hooks', () => {
    expect([...sessionsControl.commands.keys()]).toEqual(['reset-peer-budget'])
    expect(sessionsControl.hooks).toEqual([])
  })
})

describe('reset-peer-budget', () => {
  it('resets the budget of the peer the route names', async () => {
    const owner = planeOf(true)
    await resetPeerBudget({ plane: owner.plane, sessionId: 'p1', args: {} })
    expect(owner.calls).toEqual(['p1'])
  })

  it('throws when there is no peer to reset', async () => {
    const owner = planeOf(false)
    await expect(
      resetPeerBudget({ plane: owner.plane, sessionId: 'nope', args: {} }),
    ).rejects.toThrow('session nope has no peer to reset')
  })
})
