import type { V2Event } from '@dltech/atlas-core'

import { SESSION_LOG_STRUCTURE_VERSION, type SessionLog } from './session-log'
import type { SessionCursor, SessionWindow } from './session-window'

export type SessionLogWriter = {
  append(args: { events: readonly V2Event[]; head: SessionCursor }): void
  save(window: SessionWindow): void
  drop(): void
}

export const createSessionLogWriter = (args: {
  log: SessionLog
  sessionId: string
}): SessionLogWriter => {
  const { log, sessionId } = args
  let degraded = false
  let chain: Promise<void> = Promise.resolve()

  const evictOthers = async (): Promise<void> => {
    const held = await log.listSessions().catch(() => [] as readonly string[])
    await Promise.all(
      held
        .filter((id) => id !== sessionId)
        .map((id) => log.deleteSession(id).catch(() => undefined)),
    )
  }

  const attempt = async (run: () => Promise<unknown>): Promise<void> => {
    if (degraded) return
    const failed = await run().then(
      () => false,
      () => true,
    )
    if (!failed) return
    await evictOthers()
    await run().catch(() => {
      degraded = true
    })
  }

  const enqueue = (run: () => Promise<unknown>): void => {
    chain = chain.then(() => attempt(run))
  }

  return {
    append: ({ events, head }) => enqueue(() => log.appendPage({ sessionId, events, head })),
    save: (window) => {
      const { cursor, visibility, pending } = window
      if (cursor === undefined) return
      enqueue(() =>
        log.saveSnapshot({
          sessionId,
          snapshot: {
            version: SESSION_LOG_STRUCTURE_VERSION,
            cursor,
            visibility,
            pending,
            throughSeq: cursor.seq,
          },
        }),
      )
    },
    drop: () => {
      chain = chain.then(() => log.deleteSession(sessionId).catch(() => undefined))
    },
  }
}
