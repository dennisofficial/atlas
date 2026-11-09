import type { SessionCache } from '@dltech/atlas-client/stream'

export type QueuedSessionCache = SessionCache & {
  drain: () => Promise<void>
  stop: () => void
}

export const queuedSessionCache = (cache: SessionCache): QueuedSessionCache => {
  let chain: Promise<void> = Promise.resolve()
  let stopped = false

  const run = <T>(operation: () => Promise<T>): Promise<T | undefined> => {
    const pending = chain.then(() => (stopped ? undefined : operation()))
    chain = pending.then(
      () => undefined,
      () => undefined,
    )
    return pending
  }

  return {
    load: (sessionId) => run(() => cache.load(sessionId)).then((window) => window ?? undefined),
    save: (args) => run(() => cache.save(args)).then(() => undefined),
    drain: () => chain,
    stop: () => {
      stopped = true
    },
  }
}
