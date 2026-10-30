import { EAgentStatus } from '@dltech/atlas-core'

import { formatElapsed } from '../transcript/format-elapsed'

export type CrewReadout = {
  status: EAgentStatus
  startedAt: string
  endedAt: string | null
  waitingOn?: string | undefined
}

export type CrewActivity = { shells: number; subagents: number }

export type TruncateCells = (args: { text: string; cells: number }) => string

export enum ESubagentReading {
  Live = 'live',
  Held = 'held',
  Settled = 'settled',
}

export enum EContextTone {
  Normal = 'normal',
  Warn = 'warn',
  Danger = 'danger',
}

export const CONTEXT_WARN_TOKENS = 200_000

export const CONTEXT_DANGER_TOKENS = 300_000

const THOUSAND = 1_000
const MILLION = 1_000_000
const BILLION = 1_000_000_000

export function formatTokens(tokens: number): string {
  if (tokens < THOUSAND) return String(tokens)
  if (tokens < MILLION) return `${(tokens / THOUSAND).toFixed(1)}k`
  if (tokens < BILLION) return `${(tokens / MILLION).toFixed(2)}m`
  return `${(tokens / BILLION).toFixed(2)}b`
}

export function contextTokensTone(tokens: number): EContextTone {
  if (tokens >= CONTEXT_DANGER_TOKENS) return EContextTone.Danger
  if (tokens >= CONTEXT_WARN_TOKENS) return EContextTone.Warn
  return EContextTone.Normal
}

export const isSubagentWaiting = (subagent: { waitingOn?: string | undefined }): boolean =>
  subagent.waitingOn !== undefined

export const isSubagentAlive = (subagent: { status: EAgentStatus }): boolean =>
  subagent.status === EAgentStatus.Running || subagent.status === EAgentStatus.Blocked

export const isSubagentWorking = (subagent: {
  status: EAgentStatus
  activity?: CrewActivity | undefined
  waitingOn?: string | undefined
}): boolean =>
  isSubagentAlive(subagent) || subagent.activity !== undefined || isSubagentWaiting(subagent)

const WENT_WRONG: Record<EAgentStatus, boolean> = {
  [EAgentStatus.Running]: false,
  [EAgentStatus.Blocked]: false,
  [EAgentStatus.Finished]: false,
  [EAgentStatus.Failed]: true,
  [EAgentStatus.Stopped]: true,
  [EAgentStatus.Paused]: false,
}

export const subagentWentWrong = (subagent: { status: EAgentStatus }): boolean =>
  WENT_WRONG[subagent.status]

const READING: Record<EAgentStatus, ESubagentReading> = {
  [EAgentStatus.Running]: ESubagentReading.Live,
  [EAgentStatus.Blocked]: ESubagentReading.Held,
  [EAgentStatus.Finished]: ESubagentReading.Settled,
  [EAgentStatus.Failed]: ESubagentReading.Settled,
  [EAgentStatus.Stopped]: ESubagentReading.Settled,
  [EAgentStatus.Paused]: ESubagentReading.Held,
}

const STATE_LABEL: Record<EAgentStatus, string> = {
  [EAgentStatus.Running]: 'running',
  [EAgentStatus.Blocked]: 'blocked',
  [EAgentStatus.Finished]: 'done',
  [EAgentStatus.Failed]: 'failed',
  [EAgentStatus.Stopped]: 'stopped',
  [EAgentStatus.Paused]: 'paused',
}

export const subagentReading = (subagent: { status: EAgentStatus }): ESubagentReading =>
  READING[subagent.status]

export const subagentShowsElapsed = (subagent: {
  status: EAgentStatus
  waitingOn?: string | undefined
}): boolean =>
  subagentReading(subagent) !== ESubagentReading.Settled && !isSubagentWaiting(subagent)

export function crewRowReading(subagent: {
  status: EAgentStatus
  activity?: CrewActivity | undefined
  waitingOn?: string | undefined
}): ESubagentReading {
  const reading = subagentReading(subagent)
  if (
    reading === ESubagentReading.Settled &&
    (subagent.activity !== undefined || isSubagentWaiting(subagent))
  ) {
    return ESubagentReading.Live
  }
  return reading
}

const instantOf = (iso: string): number | null => {
  const at = Date.parse(iso)
  return Number.isNaN(at) ? null : at
}

export function subagentElapsedMs(args: {
  subagent: Pick<CrewReadout, 'startedAt' | 'endedAt'>
  now: number
}): number | null {
  const started = instantOf(args.subagent.startedAt)
  if (started === null) return null

  const ended = args.subagent.endedAt === null ? null : instantOf(args.subagent.endedAt)
  return Math.max(0, (ended ?? args.now) - started)
}

const WAITING_CELLS = 24

const READOUT_SEPARATOR = ' · '

const stateWord = (subagent: { status: EAgentStatus }): string => STATE_LABEL[subagent.status]

const READOUT: Record<
  ESubagentReading,
  (parts: { subagent: CrewReadout; since: string | null }) => readonly (string | null)[]
> = {
  [ESubagentReading.Live]: ({ since }) => [since],
  [ESubagentReading.Held]: ({ subagent, since }) => [stateWord(subagent), since],
  [ESubagentReading.Settled]: ({ subagent }) =>
    subagent.status === EAgentStatus.Finished ? [] : [stateWord(subagent)],
}

export function subagentStateLabel(args: {
  subagent: CrewReadout
  now: number
  truncate?: TruncateCells | undefined
}): string {
  const { subagent } = args
  if (isSubagentWaiting(subagent)) {
    const text = `waiting on ${subagent.waitingOn}`
    return args.truncate === undefined ? text : args.truncate({ text, cells: WAITING_CELLS })
  }
  const elapsed = subagentElapsedMs({ subagent, now: args.now })
  const parts = READOUT[subagentReading(subagent)]({
    subagent,
    since: elapsed === null ? null : formatElapsed(elapsed),
  })

  const written = parts.filter((part): part is string => part !== null).join(READOUT_SEPARATOR)
  if (written !== '') return written

  return subagentReading(subagent) === ESubagentReading.Settled ? '' : stateWord(subagent)
}

export function subagentContextLabel(
  context: { tokens: number; window?: number | undefined } | undefined,
): string | null {
  return context === undefined ? null : formatTokens(context.tokens)
}
