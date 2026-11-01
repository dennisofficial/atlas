import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { createPrObservationRegistry } from '../pr-observation-registry'
import { EPrObservationPriority } from '../pr-observation-targets'
import { installObservationIntersections } from './pr-observation.fixture'

beforeAll(() => {
  GlobalRegistrator.register()
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const target = (number: number) => ({ repo: 'owner/repo', number })

describe('PR visibility registry', () => {
  it('uses one observer, contributes only visible summaries, updates them and releases removed elements', () => {
    const intersections = installObservationIntersections()
    const registry = createPrObservationRegistry()
    const first = document.createElement('a')
    const second = document.createElement('section')
    const row = registry.register({ element: first, targets: [target(2)] })
    const card = registry.register({ element: second, targets: [target(1), target(2), target(3)] })
    try {
      expect(intersections.observers).toHaveLength(1)
      expect(registry.snapshot()).toEqual([])
      intersections.emit([{ element: first, visible: true }])
      expect(registry.snapshot()).toEqual([target(2)])
      intersections.emit([{ element: second, visible: true }])
      expect(registry.snapshot()).toEqual([target(1), target(2), target(3)])
      intersections.emit([{ element: first, visible: false }])
      expect(registry.snapshot()).toEqual([target(1), target(2), target(3)])
      card.update([target(4)])
      expect(registry.snapshot()).toEqual([target(4)])
      card.remove()
      expect(registry.snapshot()).toEqual([])
      intersections.emit([{ element: first, visible: true }])
      expect(registry.snapshot()).toEqual([target(2)])
      row.remove()
      expect(registry.snapshot()).toEqual([])
    } finally {
      registry.dispose()
      intersections.restore()
    }
  })

  it('does not publish duplicate identities or unchanged viewport notifications', () => {
    const intersections = installObservationIntersections()
    const registry = createPrObservationRegistry()
    let notifications = 0
    const stop = registry.subscribe(() => {
      notifications += 1
    })
    const element = document.createElement('a')
    const registration = registry.register({
      element,
      targets: [target(1), { repo: 'github.com/OWNER/REPO', number: 1 }],
    })
    try {
      intersections.emit([{ element, visible: true }])
      const held = registry.snapshot()
      intersections.emit([{ element, visible: true }])
      registration.update([target(1)])
      expect(registry.snapshot()).toBe(held)
      expect(notifications).toBe(1)
      registry.dispose()
      expect(registry.snapshot()).toEqual([])
      expect(intersections.observers[0]?.disconnected).toBe(true)
    } finally {
      stop()
      registry.dispose()
      intersections.restore()
    }
  })

  it('preserves the strongest visible registration class and publishes a class change when inline leaves', () => {
    const intersections = installObservationIntersections()
    const registry = createPrObservationRegistry()
    const row = document.createElement('a')
    const card = document.createElement('section')
    const inline = registry.register({
      element: row,
      targets: [{ ...target(140), priority: EPrObservationPriority.Inline }],
    })
    registry.register({ element: card, targets: [target(140)] })
    try {
      intersections.emit([
        { element: row, visible: true },
        { element: card, visible: true },
      ])
      const priority = registry.snapshot()
      expect(priority).toEqual([{ ...target(140), priority: EPrObservationPriority.Inline }])
      inline.remove()
      expect(registry.snapshot()).not.toBe(priority)
      expect(registry.snapshot()).toEqual([target(140)])
      expect(intersections.observers).toHaveLength(1)
    } finally {
      registry.dispose()
      intersections.restore()
    }
  })

  it('fails closed when IntersectionObserver is unavailable', () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver')
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      configurable: true,
      value: undefined,
    })
    const registry = createPrObservationRegistry()
    try {
      registry.register({ element: document.createElement('a'), targets: [target(1)] })
      expect(registry.snapshot()).toEqual([])
    } finally {
      registry.dispose()
      if (previous === undefined) Reflect.deleteProperty(globalThis, 'IntersectionObserver')
      else Object.defineProperty(globalThis, 'IntersectionObserver', previous)
    }
  })
})
