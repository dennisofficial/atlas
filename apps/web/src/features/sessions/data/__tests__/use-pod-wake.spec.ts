import { describe, expect, it } from 'bun:test'

import { nextPodWakeState } from '../use-pod-wake'

describe('nextPodWakeState', () => {
  it('goes asleep -> waking on a click and stays waking on a second click', () => {
    const waking = nextPodWakeState({ previous: 'asleep', event: 'wake' })
    expect(waking).toBe('waking')
    expect(nextPodWakeState({ previous: waking, event: 'wake' })).toBe('waking')
  })

  it('returns to asleep when the lease turns live', () => {
    expect(nextPodWakeState({ previous: 'waking', event: 'live' })).toBe('asleep')
  })

  it('times out only while waking', () => {
    expect(nextPodWakeState({ previous: 'waking', event: 'timeout' })).toBe('timeout')
    expect(nextPodWakeState({ previous: 'asleep', event: 'timeout' })).toBe('asleep')
  })

  it('reports a pod held elsewhere', () => {
    expect(nextPodWakeState({ previous: 'asleep', event: 'elsewhere' })).toBe('elsewhere')
  })
})
