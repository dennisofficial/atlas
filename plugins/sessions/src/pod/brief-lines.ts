import { ESessionStatus } from '@dltech/atlas-core'
import type { SessionBrief } from '@dltech/atlas-plugin-sdk'

const FAILED_STATES: ReadonlySet<ESessionStatus> = new Set([
  ESessionStatus.SetupFailed,
  ESessionStatus.StartFailed,
  ESessionStatus.Failed,
])

export const statusOf = (brief: SessionBrief): string => {
  if (brief.archivedAt !== null) return `archived ${brief.archivedAt}`
  const status = brief.status
  if (status === null || status.state === ESessionStatus.Idle) return 'idle'
  if (FAILED_STATES.has(status.state)) return `failed: ${status.reason ?? status.state}`
  return 'working'
}

export const lineOf = (brief: SessionBrief): string => {
  const title = brief.title ?? 'untitled'
  const current = brief.current ? '  current' : ''
  return `${brief.sessionId}  ${title}  ${statusOf(brief)}${current}`
}
