import {
  createSqliteSessionLog,
  memorySessionLog,
  type SessionLog,
} from '@dltech/atlas-client/stream'

import { openSqliteExecutor } from '../../storage/sqlite-executor'
import { eventSchema } from './registered-plugins'
import { queuedSessionLog, type QueuedSessionLog } from './session-cache-queue'

export const SESSION_LOG_DATABASE = 'atlas-sessions'

let opened: QueuedSessionLog | undefined
let opening: Promise<QueuedSessionLog> | undefined

const open = async (): Promise<SessionLog> => {
  try {
    const db = await openSqliteExecutor(SESSION_LOG_DATABASE)
    const stored = createSqliteSessionLog({ db, eventSchema: eventSchema })
    await stored.prepare()
    return stored
  } catch {
    return memorySessionLog()
  }
}

const queueOf = (): Promise<QueuedSessionLog> => {
  opening ??= open().then((log) => {
    opened = queuedSessionLog(log)
    return opened
  })
  return opening
}

const deferred = <T>(run: (log: SessionLog) => Promise<T>): Promise<T> => queueOf().then(run)

export const sessionLog = (): SessionLog => ({
  appendPage: (args) => deferred((log) => log.appendPage(args)),
  readRange: (args) => deferred((log) => log.readRange(args)),
  readTail: (args) => deferred((log) => log.readTail(args)),
  readBefore: (args) => deferred((log) => log.readBefore(args)),
  loadSnapshot: (sessionId) => deferred((log) => log.loadSnapshot(sessionId)),
  saveSnapshot: (args) => deferred((log) => log.saveSnapshot(args)),
  deleteSession: (sessionId) => deferred((log) => log.deleteSession(sessionId)),
  listSessions: () => deferred((log) => log.listSessions()),
  clear: () => deferred((log) => log.clear()),
})

export const clearSessionLog = async (): Promise<void> => {
  const held = opened
  await held?.drain().catch(() => undefined)
  await held?.clear().catch(() => undefined)
  held?.stop()
  opened = undefined
  opening = undefined
}
