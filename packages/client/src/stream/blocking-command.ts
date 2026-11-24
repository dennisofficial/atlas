import { ESessionStatus } from '@dltech/atlas-core'
import { ECommandState, type SessionCommandRow } from '@dltech/atlas-protocol'

import type { SessionSnapshot } from './session-follower'

type Status = SessionSnapshot['status']

export type BlockingCopy = { readonly label: string; readonly queued: string }

export type BlockingCommand = {
  readonly inboxId: number
  readonly name: string
  readonly startedAt: string
  readonly copy: BlockingCopy
}

export const BLOCKING_SEND_NOTE = 'Messages you send now wait for it'

const BLOCKING_COPY: Readonly<Record<string, BlockingCopy>> = {
  summarise: { label: 'Summarising history', queued: 'Waits for the summary' },
  rewind: { label: 'Rewinding', queued: 'Waits for the rewind' },
  rotate: { label: 'Starting a fresh context', queued: 'Waits for the fresh context' },
  resume: { label: 'Resuming', queued: 'Waits for the resume' },
}

export const blockingCopyOf = (name: string): BlockingCopy | undefined => BLOCKING_COPY[name]

const startedAtOf = (args: { status: NonNullable<Status>; row: SessionCommandRow }): string => {
  const { status, row } = args
  const own = status.state === ESessionStatus.RunningCommand && status.reason === row.name
  return own && status.since !== undefined ? status.since : row.postedAt
}

export const blockingCommandOf = (status: Status): BlockingCommand | undefined => {
  if (status === undefined) return undefined
  for (const row of status.commands ?? []) {
    if (row.state !== ECommandState.Running) continue
    const copy = blockingCopyOf(row.name)
    if (copy === undefined) continue
    return { inboxId: row.inboxId, name: row.name, startedAt: startedAtOf({ status, row }), copy }
  }
  return undefined
}

export const elapsedClockOf = (args: { startedAt: string; now: number }): string => {
  const seconds = Math.max(0, Math.floor((args.now - Date.parse(args.startedAt)) / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}
