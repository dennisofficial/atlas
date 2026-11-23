import { snapshotOf, type FollowedState, type SessionSnapshot } from './follower-state'
import type { StreamScheduler } from './stream-ports'

export const CATCH_UP_RENDER_MS = 500

export type FollowerRender = {
  getSnapshot(): SessionSnapshot
  subscribe(listener: () => void): () => void
  flush(): void
  defer(): void
}

export const createFollowerRender = (args: {
  scheduler: StreamScheduler
  innerOf: () => FollowedState
}): FollowerRender => {
  const { scheduler, innerOf } = args
  const listeners = new Set<() => void>()
  let snapshot = snapshotOf(innerOf())
  let timer: unknown

  const clear = (): void => {
    if (timer === undefined) return
    scheduler.clearTimeout(timer)
    timer = undefined
  }

  const flush = (): void => {
    clear()
    snapshot = snapshotOf(innerOf())
    for (const listener of [...listeners]) listener()
  }

  const defer = (): void => {
    if (timer !== undefined) return
    timer = scheduler.setTimeout(flush, CATCH_UP_RENDER_MS)
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    flush,
    defer,
  }
}
