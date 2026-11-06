import type { SessionSummary } from '@dltech/atlas-protocol'

import type { ControlSessionDigest } from './port'

export const NAMING_WINDOW_MS = 60_000
export const FALLBACK_TITLE_CHARS = 40

export const fallbackTitleOf = (text: string): string | null => {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length === 0) return null
  if (flat.length <= FALLBACK_TITLE_CHARS) return flat
  const cut = flat.slice(0, FALLBACK_TITLE_CHARS)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

const namingOf = (args: { digest: ControlSessionDigest; now: number }): boolean => {
  const { digest } = args
  if (digest.title !== null || digest.firstMessageAt === null) return false
  return args.now - Date.parse(digest.firstMessageAt) < NAMING_WINDOW_MS
}

export const sessionSummaryOf = (args: {
  digest: ControlSessionDigest
  now: number
}): SessionSummary => {
  const { digest } = args
  const naming = namingOf(args)
  const fallback = naming ? null : fallbackTitleOf(digest.firstMessageText ?? '')
  return {
    sessionId: digest.sessionId,
    projectId: digest.projectId,
    title: digest.title ?? fallback,
    naming,
    mainThreadId: digest.mainThreadId,
    createdAt: digest.createdAt,
    updatedAt: digest.lastEventAt ?? digest.createdAt,
    archivedAt: digest.archivedAt,
  }
}
