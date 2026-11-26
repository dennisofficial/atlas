import type { StreamSessionRow } from '@dltech/atlas-protocol'

import { EWorkKind, type SessionWork, sessionWorkOf } from '../../sessions/session-groups'

export const UNTITLED = 'Untitled'

export type SessionHeader = {
  title: string
  work: SessionWork
}

const NO_WORK: SessionWork = { kind: EWorkKind.Branch, branch: null }

const filled = (value: string | null | undefined): string | undefined =>
  value === null || value === undefined || value.trim().length === 0 ? undefined : value

const titleOf = (args: {
  summary: StreamSessionRow | undefined
  fallbackTitle: string | undefined
}): string =>
  filled(args.summary?.title) ??
  filled(args.fallbackTitle) ??
  (args.summary === undefined ? '' : UNTITLED)

export const sessionHeaderOf = (args: {
  summary: StreamSessionRow | undefined
  fallbackTitle: string | undefined
}): SessionHeader => ({
  title: titleOf(args),
  work: args.summary === undefined ? NO_WORK : sessionWorkOf(args.summary),
})
