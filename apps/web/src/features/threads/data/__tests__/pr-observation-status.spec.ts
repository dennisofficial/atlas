import { describe, expect, it } from 'bun:test'

import { EGithubPrStatesFrame } from '@dltech/atlas-wire/web'

import { createPrObservationNotifier } from '../pr-observation-status'

describe('PR observation diagnostics', () => {
  it('warns once per outage message, preserves an honest stale-cache fallback, and clears on recovery or release', () => {
    const warnings: string[] = []
    let clears = 0
    const notify = createPrObservationNotifier({
      warn: (message) => warnings.push(message),
      clear: () => {
        clears += 1
      },
    })
    const unavailable = { type: EGithubPrStatesFrame.ObservationStatus as const, available: false }
    notify(unavailable)
    notify(unavailable)
    notify({ ...unavailable, message: ' ' })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Cached checks may be stale')
    notify({ ...unavailable, message: 'Observation store unavailable' })
    expect(warnings).toHaveLength(2)
    notify({ ...unavailable, available: true })
    notify({ ...unavailable, available: true })
    expect(clears).toBe(1)
    notify(unavailable)
    notify(null)
    expect(clears).toBe(2)
  })
})
