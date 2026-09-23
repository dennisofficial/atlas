import { join } from 'node:path'

import type { ThreadId } from '@dltech/atlas-core'

export const SESSIONS_DIRECTORY_NAME = 'sessions'
export const THREADS_DIRECTORY_NAME = 'threads'
export const SESSION_LOCK_NAME = 'lock'
export const SESSION_META_NAME = 'meta.json'
export const LEDGER_FILE_NAME = 'ledger.jsonl'
export const EVENTS_FILE_SUFFIX = '.events.jsonl'
export const THREAD_META_FILE_SUFFIX = '.meta.json'

export function sessionsDirectory({ home }: { home: string }): string {
  return join(home, SESSIONS_DIRECTORY_NAME)
}

export function sessionDirectory({ home, sessionId }: { home: string; sessionId: string }): string {
  return join(sessionsDirectory({ home }), sessionId)
}

export function threadsDirectory({ sessionDir }: { sessionDir: string }): string {
  return join(sessionDir, THREADS_DIRECTORY_NAME)
}

export function sessionLockFile({ sessionDir }: { sessionDir: string }): string {
  return join(sessionDir, SESSION_LOCK_NAME)
}

export function sessionMetaFile({ sessionDir }: { sessionDir: string }): string {
  return join(sessionDir, SESSION_META_NAME)
}

export function ledgerFile({ sessionDir }: { sessionDir: string }): string {
  return join(sessionDir, LEDGER_FILE_NAME)
}

export function eventLogFile({
  sessionDir,
  threadId,
}: {
  sessionDir: string
  threadId: ThreadId
}): string {
  return join(threadsDirectory({ sessionDir }), `${threadId}${EVENTS_FILE_SUFFIX}`)
}

export function threadMetaFile({
  sessionDir,
  threadId,
}: {
  sessionDir: string
  threadId: ThreadId
}): string {
  return join(threadsDirectory({ sessionDir }), `${threadId}${THREAD_META_FILE_SUFFIX}`)
}
