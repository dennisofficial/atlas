import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { githubPrStatesInputSchema } from '@dltech/atlas-wire/web'

import { subscribeApiPrStates } from '../api-pr-states-source'
import { EPrObservationPriority } from '../pr-observation-targets'
import { observationSourceRig } from './pr-observation.fixture'

beforeAll(() => {
  GlobalRegistrator.register()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const target = (number: number) => ({ repo: 'owner/repo', number })

describe('shared inline-first observation cap', () => {
  it('reserves inline targets across consumers before capped metadata and strips client priority from the channel', () => {
    const source = observationSourceRig()
    const bulk = Array.from({ length: 140 }, (_, index) => target(index + 1))
    const stopBulk = subscribeApiPrStates({
      subscribe: source.subscribe,
      observe: bulk,
      onStates: () => {},
    })
    const stopInline = subscribeApiPrStates({
      subscribe: source.subscribe,
      observe: [
        {
          repo: 'https://github.com/OWNER/REPO',
          number: 140,
          priority: EPrObservationPriority.Inline,
        },
        { ...target(141), priority: EPrObservationPriority.Inline },
      ],
      onStates: () => {},
    })
    try {
      expect(source.observations()).toHaveLength(128)
      expect(source.observations()).toContainEqual(target(140))
      expect(source.observations()).toContainEqual(target(141))
      expect(source.observations()).toContainEqual(target(126))
      expect(source.observations()).not.toContainEqual(target(127))
      expect(githubPrStatesInputSchema.safeParse({ observe: source.observations() }).success).toBe(
        true,
      )
      const connections = source.connections.length
      stopBulk.setObservations([...bulk].reverse())
      expect(source.connections).toHaveLength(connections)
      expect(source.active()).toBe(1)
      expect(source.peak()).toBe(1)
      stopInline()
      expect(source.observations()).toHaveLength(128)
      expect(source.observations()).not.toContainEqual(target(140))
    } finally {
      stopInline()
      stopBulk()
    }
    expect(source.active()).toBe(0)
  })

  it('does not reconnect when priority changes leave the effective normalized wire target union unchanged', () => {
    const source = observationSourceRig()
    const bulk = subscribeApiPrStates({
      subscribe: source.subscribe,
      observe: [target(140), target(141)],
      onStates: () => {},
    })
    const inline = subscribeApiPrStates({
      subscribe: source.subscribe,
      observe: [{ ...target(141), priority: EPrObservationPriority.Inline }],
      onStates: () => {},
    })
    expect(source.connections).toHaveLength(1)
    expect(source.observations()).toEqual([target(140), target(141)])
    inline.setObservations([{ ...target(140), priority: EPrObservationPriority.Inline }])
    expect(source.connections).toHaveLength(1)
    expect(source.observations()).toEqual([target(140), target(141)])
    inline.setObservations([
      { repo: 'github.com/OWNER/REPO', number: 140, priority: EPrObservationPriority.Bulk },
    ])
    expect(source.connections).toHaveLength(1)
    expect(source.observations()).toEqual([target(140), target(141)])
    inline()
    expect(source.connections).toHaveLength(1)
    bulk()
  })
})
