type StartViewTransition = (update: () => void) => { finished: Promise<void> }

export type ViewTransitionStub = {
  started: () => number
  runPending: () => void
  restore: () => void
}

export function stubViewTransitions(): ViewTransitionStub {
  const pending: Array<() => void> = []
  let started = 0
  const originalMatchMedia = window.matchMedia
  const start: StartViewTransition = (update) => {
    started += 1
    pending.push(update)
    return { finished: Promise.resolve() }
  }
  Object.assign(document, { startViewTransition: start })
  window.matchMedia = (query: string) =>
    ({ matches: query.includes('min-width'), media: query }) as MediaQueryList
  return {
    started: () => started,
    runPending: () => {
      for (const update of pending.splice(0)) update()
    },
    restore: () => {
      Reflect.deleteProperty(document, 'startViewTransition')
      window.matchMedia = originalMatchMedia
    },
  }
}
