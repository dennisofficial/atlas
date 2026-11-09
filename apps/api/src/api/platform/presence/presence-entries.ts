export const PRESENCE_HEARTBEAT_MS = 25_000
export const PRESENCE_STALE_MS = 70_000

export type PresenceEntry = { clientId: string; threadId: string; at: number }

export const formatPresence = (entry: { threadId: string; at: number }): string =>
  `${entry.at}|${entry.threadId}`

export const parsePresence = (args: {
  clientId: string
  raw: string
}): PresenceEntry | undefined => {
  const separator = args.raw.indexOf('|')
  if (separator <= 0) return undefined
  const at = Number(args.raw.slice(0, separator))
  if (!Number.isFinite(at)) return undefined
  const threadId = args.raw.slice(separator + 1)
  if (threadId.length === 0) return undefined
  return { clientId: args.clientId, threadId, at }
}

export const parsePresenceHash = (hash: Record<string, string>): PresenceEntry[] =>
  Object.entries(hash).flatMap(([clientId, raw]) => parsePresence({ clientId, raw }) ?? [])

export const isWatchingThread = (args: {
  entries: PresenceEntry[]
  threadId: string
  now: number
  staleMs?: number
}): boolean => {
  const staleMs = args.staleMs ?? PRESENCE_STALE_MS
  return args.entries.some(
    (entry) => entry.threadId === args.threadId && args.now - entry.at <= staleMs,
  )
}
