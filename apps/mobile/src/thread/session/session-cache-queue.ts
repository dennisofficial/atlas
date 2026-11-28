import type { SessionLog } from '@dltech/atlas-client/stream'

export type QueuedSessionLog = SessionLog & {
  drain: () => Promise<void>
  stop: () => void
}

export const queuedSessionLog = (log: SessionLog): QueuedSessionLog => {
  let chain: Promise<void> = Promise.resolve()
  let stopped = false

  const run = <T>(args: { operation: () => Promise<T>; fallback: T }): Promise<T> => {
    const pending = chain.then(() => (stopped ? args.fallback : args.operation()))
    chain = pending.then(
      () => undefined,
      () => undefined,
    )
    return pending
  }

  return {
    appendPage: (args) => run({ operation: () => log.appendPage(args), fallback: undefined }),
    readRange: (args) => run({ operation: () => log.readRange(args), fallback: [] }),
    readTail: (args) => run({ operation: () => log.readTail(args), fallback: [] }),
    readBefore: (args) => run({ operation: () => log.readBefore(args), fallback: [] }),
    loadSnapshot: (sessionId) =>
      run({ operation: () => log.loadSnapshot(sessionId), fallback: undefined }),
    saveSnapshot: (args) => run({ operation: () => log.saveSnapshot(args), fallback: undefined }),
    deleteSession: (sessionId) =>
      run({ operation: () => log.deleteSession(sessionId), fallback: undefined }),
    listSessions: () => run({ operation: () => log.listSessions(), fallback: [] }),
    clear: () => run({ operation: () => log.clear(), fallback: undefined }),
    drain: () => chain,
    stop: () => {
      stopped = true
    },
  }
}
