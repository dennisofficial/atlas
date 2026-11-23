import {
  ESessionDisplay,
  sessionDisplayOf,
  type SessionSnapshot,
} from '@dltech/atlas-client/stream'
import { formatElapsed } from '@dltech/atlas-client/transcript'
import type { StreamSessionRow } from '@dltech/atlas-protocol'

export const UNTITLED = 'Untitled'

const LABEL: Record<ESessionDisplay, string> = {
  [ESessionDisplay.Starting]: 'Starting',
  [ESessionDisplay.StartFailed]: 'Start failed',
  [ESessionDisplay.Working]: 'Working',
  [ESessionDisplay.WaitingForYou]: 'Waiting for you',
  [ESessionDisplay.Idle]: 'Idle',
  [ESessionDisplay.Parked]: 'Parked',
  [ESessionDisplay.Failed]: 'Failed',
}

export type SessionHeader = {
  title: string
  display: ESessionDisplay | undefined
  subtitle: string | null
}

const filled = (value: string | null | undefined): string | undefined =>
  value === null || value === undefined || value.trim().length === 0 ? undefined : value

const titleOf = (args: {
  summary: StreamSessionRow | undefined
  fallbackTitle: string | undefined
}): string =>
  filled(args.summary?.title) ??
  filled(args.fallbackTitle) ??
  (args.summary === undefined ? '' : UNTITLED)

const elapsedOf = (args: {
  turnStartedAt: string | undefined
  now: number
}): string | undefined => {
  if (args.turnStartedAt === undefined) return undefined
  const started = Date.parse(args.turnStartedAt)
  if (Number.isNaN(started)) return undefined
  return formatElapsed(Math.max(0, args.now - started))
}

export const sessionHeaderOf = (args: {
  summary: StreamSessionRow | undefined
  fallbackTitle: string | undefined
  status: SessionSnapshot['status']
  turnStartedAt: string | undefined
  now: number
}): SessionHeader => {
  const display = sessionDisplayOf({
    state: args.status?.state ?? args.summary?.status?.state,
    sandboxStatus: args.status?.sandbox?.status ?? args.summary?.sandbox?.status,
  })
  const title = titleOf(args)
  if (display === undefined) return { title, display, subtitle: null }
  const elapsed = display === ESessionDisplay.Working ? elapsedOf(args) : undefined
  const label = LABEL[display]
  return { title, display, subtitle: elapsed === undefined ? label : `${label} · ${elapsed}` }
}
