import { THREADS } from '../shell/fixtures/app'
import { TEAMMATES } from '../shell/fixtures/teammates'

const KNOWN_THREAD_IDS = new Set([
  ...THREADS.map((thread) => thread.id),
  ...TEAMMATES.map((teammate) => teammate.id),
])

export function isKnownThreadId(threadId: string): boolean {
  return KNOWN_THREAD_IDS.has(threadId)
}
