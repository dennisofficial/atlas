import { EGithubPrStatesFrame, type GithubPrStatesFrame } from '@dltech/atlas-wire/web'

import type { ApiPrStatesSubscribe } from '../api-pr-states-source'

export function observationSourceRig() {
  const connections: { handlers: Parameters<ApiPrStatesSubscribe>[0]; stops: number }[] = []
  let active = 0
  let peak = 0
  const subscribe: ApiPrStatesSubscribe = (handlers) => {
    active += 1
    peak = Math.max(peak, active)
    const connection = { handlers, stops: 0 }
    connections.push(connection)
    return {
      unsubscribe: () => {
        connection.stops += 1
        active -= 1
      },
    }
  }
  return {
    subscribe,
    connections,
    active: () => active,
    peak: () => peak,
    latest: () => connections.at(-1)?.handlers,
    observations: () => connections.at(-1)?.handlers.observe ?? [],
  }
}

export const observationFrameOf = (checksPassed: number): GithubPrStatesFrame => ({
  type: EGithubPrStatesFrame.PrState,
  state: {
    repoFullName: 'owner/repo',
    prNumber: 1,
    title: 'Live checks',
    url: 'https://github.com/owner/repo/pull/1',
    state: 'open',
    headBranch: 'topic',
    headSha: 'abc',
    checksRunning: 0,
    checksPassed,
    checksFailed: 0,
    mergeable: true,
    updatedAt: '',
  },
})

export function installObservationIntersections() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver')
  const observers: {
    callback: (entries: IntersectionObserverEntry[]) => void
    elements: Set<Element>
    disconnected: boolean
  }[] = []
  class Observer {
    readonly entry: (typeof observers)[number]
    constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
      this.entry = { callback, elements: new Set(), disconnected: false }
      observers.push(this.entry)
    }
    observe(element: Element) {
      this.entry.elements.add(element)
    }
    unobserve(element: Element) {
      this.entry.elements.delete(element)
    }
    disconnect() {
      this.entry.disconnected = true
      this.entry.elements.clear()
    }
  }
  Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, value: Observer })
  return {
    observers,
    emit: (args: { element: Element; visible: boolean }[]) => {
      for (const observer of observers) {
        const entries = args
          .filter(({ element }) => observer.elements.has(element))
          .map(({ element, visible }) => ({
            target: element,
            isIntersecting: visible,
            intersectionRatio: visible ? 1 : 0,
            time: 0,
            boundingClientRect: element.getBoundingClientRect(),
            intersectionRect: element.getBoundingClientRect(),
            rootBounds: null,
          }))
        if (entries.length > 0) observer.callback(entries)
      }
    },
    restore: () => {
      if (previous === undefined) Reflect.deleteProperty(globalThis, 'IntersectionObserver')
      else Object.defineProperty(globalThis, 'IntersectionObserver', previous)
    },
  }
}
