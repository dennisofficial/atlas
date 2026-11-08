import { formatElapsed } from '../transcript/format-elapsed'

export type BackgroundWork = {
  subagents: number
  shells: number
}

export const NOTHING_IN_BACKGROUND: BackgroundWork = { subagents: 0, shells: 0 }

export const isWaiting = (work: BackgroundWork): boolean => work.subagents + work.shells > 0

const tally = (args: { count: number; noun: string }): string =>
  `${args.count} ${args.noun}${args.count === 1 ? '' : 's'}`

const WAITED_SEPARATOR = ' · '

const instantOf = (iso: string): number | null => {
  const at = Date.parse(iso)
  return Number.isNaN(at) ? null : at
}

/**
 * When the wait began: the instant the settled turn ended at, which survives a reload, a reopen on
 * another client and a restarted app. A transcript with no timestamp to read falls back to `held`,
 * the moment this client first watched the wait.
 */
export function waitStartedAt(args: {
  settledAt?: string | undefined
  held: number | null
}): number | null {
  if (args.settledAt === undefined) return args.held
  return instantOf(args.settledAt) ?? args.held
}

/**
 * The elapsed reading is how long the harness has been idle on this work, not how long the work
 * has been running: a shell started three turns ago is only being waited on from the moment the
 * turn settled with nothing left to do but hear back from it.
 */
export function backgroundWaitLabel(args: {
  work: BackgroundWork
  waitedMs?: number | undefined
}): string | null {
  const tallies = [
    args.work.subagents > 0
      ? tally({ count: args.work.subagents, noun: 'background agent' })
      : null,
    args.work.shells > 0 ? tally({ count: args.work.shells, noun: 'shell' }) : null,
  ].filter((part): part is string => part !== null)

  if (tallies.length === 0) return null

  const waited =
    args.waitedMs === undefined ? '' : `${WAITED_SEPARATOR}${formatElapsed(args.waitedMs)}`

  return `Waiting for ${tallies.join(' and ')} to finish${waited}`
}
