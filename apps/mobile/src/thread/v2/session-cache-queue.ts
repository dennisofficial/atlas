import type { SessionLog } from '@dltech/atlas-client/stream'

export type QueuedSessionLog = SessionLog & {
  drain: () => Promise<void>
  stop: () => void
}

export const queuedSessionLog = (log: SessionLog): QueuedSessionLog => {
  let chain: Promise<void> = Promise.resolve()
  let stopped = false

  const run = <T>(operation: () => Promise<T>, fallback: T): Promise<T> => {
    const pending = chain.then(() => (stopped ? fallback : operation())).catch(() => fallback)
    chain = pending.then(
      () => undefined,
      () => undefined,
    )
    return pending
  }

  return {
    appendPage: (args) => run(() => log.appendPage(args), undefined),
    readRange: (args) => run(() => log.readRange(args), []),
    readTail: (args) => run(() => log.readTail(args), []),
    readBefore: (args) => run(() => log.readBefore(args), []),
    loadSnapshot: (sessionId) => run(() => log.loadSnapshot(sessionId), undefined),
    saveSnapshot: (args) => run(() => log.saveSnapshot(args), undefined),
    deleteSession: (sessionId) => run(() => log.deleteSession(sessionId), undefined),
    listSessions: () => run(() => log.listSessions(), []),
    clear: () => run(() => log.clear(), undefined),
    drain: () => chain,
    stop: () => {
      stopped = true
    },
  }
}
