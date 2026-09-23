import { mergeRemoteMemory, type RemoteMemoryMerge } from './merge-remote-memory'

export const DEFAULT_MERGE_REMOTE_MEMORY_TIMEOUT_MS = 5_000

export async function mergeRemoteMemoryBounded(args: {
  session: { url: string; token: string }
  cwd: string
  timeoutMs?: number | undefined
  fetchFn?: typeof fetch | undefined
}): Promise<RemoteMemoryMerge> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_MERGE_REMOTE_MEMORY_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const fetchFn = args.fetchFn ?? fetch
  const abortableFetch = ((input: URL | RequestInfo, init?: RequestInit) =>
    fetchFn(input, { ...init, signal: controller.signal })) as typeof fetch

  try {
    return await mergeRemoteMemory({ session: args.session, cwd: args.cwd, fetchFn: abortableFetch })
  } finally {
    clearTimeout(timer)
  }
}
