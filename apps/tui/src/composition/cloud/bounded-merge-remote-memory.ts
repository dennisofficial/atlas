import { ENoticeTone, NOTICE_WARN_MS, notify } from '../../ui/notice-store'
import { mergeRemoteMemory } from './merge-remote-memory'

const TIMEOUT_NOTICE_KEY = 'remote-memory-merge-timeout'

export const DEFAULT_MERGE_REMOTE_MEMORY_TIMEOUT_MS = 5_000

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * A wedged control plane must never hold session launch open: the merge races an abort against
 * this bound, and either outcome — timeout or an outright failure — is reported through a notice
 * rather than left silent, because a launch stalling with no explanation reads as a hang. Never
 * rejects, so a caller can always just await it and move on to opening the session.
 */
export async function mergeRemoteMemoryBounded(args: {
  session: { url: string; token: string }
  cwd: string
  timeoutMs?: number | undefined
  fetchFn?: typeof fetch | undefined
}): Promise<void> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_MERGE_REMOTE_MEMORY_TIMEOUT_MS
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  const fetchFn = args.fetchFn ?? fetch
  const abortableFetch = ((input: URL | RequestInfo, init?: RequestInit) =>
    fetchFn(input, { ...init, signal: controller.signal })) as typeof fetch

  try {
    await mergeRemoteMemory({ session: args.session, cwd: args.cwd, fetchFn: abortableFetch })
    if (timedOut) {
      notify({
        key: TIMEOUT_NOTICE_KEY,
        tone: ENoticeTone.Warn,
        text: 'the cloud memory merge did not finish in time and was skipped',
        ttlMs: NOTICE_WARN_MS,
      })
    }
  } catch (error) {
    notify({
      key: TIMEOUT_NOTICE_KEY,
      tone: ENoticeTone.Warn,
      text: `the cloud memory merge failed and was skipped: ${messageOf(error)}`,
      ttlMs: NOTICE_WARN_MS,
    })
  } finally {
    clearTimeout(timer)
  }
}
