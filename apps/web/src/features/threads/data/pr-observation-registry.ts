import {
  prObservationRegistrationKeyOf,
  prObservationRegistrationsOf,
  type PrObservation,
} from './pr-observation-targets'

type Registration = { targets: readonly PrObservation[]; visible: boolean }

export function createPrObservationRegistry() {
  const elements = new Map<Element, Registration>()
  const listeners = new Set<() => void>()
  let observer: IntersectionObserver | null = null
  let snapshot: readonly PrObservation[] = []

  const publish = () => {
    const next = prObservationRegistrationsOf(
      [...elements.values()].flatMap((entry) => (entry.visible ? entry.targets : [])),
    )
    if (prObservationRegistrationKeyOf(next) === prObservationRegistrationKeyOf(snapshot)) return
    snapshot = next
    for (const listener of listeners) listener()
  }

  const handleVisibility = () => {
    if (document.visibilityState === 'hidden') {
      for (const registration of elements.values()) registration.visible = false
      publish()
      return
    }
    for (const element of elements.keys()) {
      observer?.unobserve(element)
      observer?.observe(element)
    }
  }

  const ensureObserver = () => {
    if (observer !== null || typeof IntersectionObserver === 'undefined') return
    const instance = new IntersectionObserver((entries) => {
      if (observer !== instance) return
      for (const entry of entries) {
        const registration = elements.get(entry.target)
        if (registration === undefined) continue
        registration.visible =
          document.visibilityState !== 'hidden' &&
          entry.isIntersecting &&
          entry.intersectionRatio > 0
      }
      publish()
    })
    observer = instance
    document.addEventListener('visibilitychange', handleVisibility)
  }

  return {
    snapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    register: (args: { element: Element; targets: readonly PrObservation[] }) => {
      const registration = { targets: args.targets, visible: false }
      elements.set(args.element, registration)
      ensureObserver()
      observer?.observe(args.element)
      return {
        update: (targets: readonly PrObservation[]) => {
          registration.targets = targets
          publish()
        },
        remove: () => {
          if (elements.get(args.element) !== registration) return
          elements.delete(args.element)
          observer?.unobserve(args.element)
          publish()
        },
      }
    },
    dispose: () => {
      observer?.disconnect()
      observer = null
      if (typeof document !== 'undefined')
        document.removeEventListener('visibilitychange', handleVisibility)
      elements.clear()
      publish()
    },
  }
}

export type PrObservationRegistry = ReturnType<typeof createPrObservationRegistry>
