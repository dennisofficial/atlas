import { EAgentStatus, EShellStatus, type ProviderIdentity, type ThreadId } from '@dltech/atlas-core'
import type { AgentSnapshot, ChildContext, ShellSnapshot } from '@dltech/atlas-harness'

import { truncateCells } from '../ui/components/sidebar/cells'
import { formatElapsed, formatTokens } from '../ui/theme'
import { TITLE_CELLS, oneLineOf } from './sidebar-text'

export type SubagentReadout = {
  status: EAgentStatus
  startedAt: string
  endedAt: string | null
}

export type SidebarSubagent = SubagentReadout & {
  id: string
  name: string
  agentType?: string | undefined
  state: string
  model: string | null
  context?: ChildContext | undefined
  selected: boolean
  activity?: CrewActivity | undefined
}

/** What a child still has running: its own shells and its own children, nothing deeper. */
export type CrewActivity = { shells: number; subagents: number }

/** The cross-thread listings the activity is counted from: every shell and every child in the process. */
export type CrewRosters = { shells: readonly ShellSnapshot[]; children: readonly AgentSnapshot[] }

export type SidebarCrewFold = { hidden: number; hiddenFailed: boolean }

/**
 * The crew's fold hides both tiers but hangs its tally under the sub-agent one, so the per-tier
 * header counts need the split spelled out: `hidden` stays the whole retirement for the "more in
 * /agents" line, `hiddenTeammates` is what the teammate header adds back instead of the sub-agent
 * header swallowing it.
 */
export type SidebarAgentFold = SidebarCrewFold & { hiddenTeammates: number }

export const subagentLabel = (snapshot: Pick<AgentSnapshot, 'intent' | 'agentType'>): string => {
  const intent = oneLineOf(snapshot.intent)
  return truncateCells({ text: intent ?? snapshot.agentType, cells: TITLE_CELLS })
}

export const isSubagentRunning = (subagent: Pick<SidebarSubagent, 'status'>): boolean =>
  subagent.status === EAgentStatus.Running

const SUBAGENT_WENT_WRONG: Record<EAgentStatus, boolean> = {
  [EAgentStatus.Running]: false,
  [EAgentStatus.Blocked]: false,
  [EAgentStatus.Finished]: false,
  [EAgentStatus.Failed]: true,
  [EAgentStatus.Stopped]: true,
}

export const subagentWentWrong = (subagent: Pick<SidebarSubagent, 'status'>): boolean =>
  SUBAGENT_WENT_WRONG[subagent.status]

/**
 * What the narrow value column spends its cells on. A child that is still going is judged by how
 * long it has been going; one that has settled says nothing unless the ending needs saying — a
 * finished child reads as its title alone.
 */
export enum ESubagentReading {
  Live = 'live',
  Held = 'held',
  Settled = 'settled',
}

const SUBAGENT_READING: Record<EAgentStatus, ESubagentReading> = {
  [EAgentStatus.Running]: ESubagentReading.Live,
  [EAgentStatus.Blocked]: ESubagentReading.Held,
  [EAgentStatus.Finished]: ESubagentReading.Settled,
  [EAgentStatus.Failed]: ESubagentReading.Settled,
  [EAgentStatus.Stopped]: ESubagentReading.Settled,
}

const SUBAGENT_STATE_LABEL: Record<EAgentStatus, string> = {
  [EAgentStatus.Running]: 'running',
  [EAgentStatus.Blocked]: 'blocked',
  [EAgentStatus.Finished]: 'done',
  [EAgentStatus.Failed]: 'failed',
  [EAgentStatus.Stopped]: 'stopped',
}

export const subagentReading = (subagent: Pick<SidebarSubagent, 'status'>): ESubagentReading =>
  SUBAGENT_READING[subagent.status]

export const subagentShowsElapsed = (subagent: Pick<SidebarSubagent, 'status'>): boolean =>
  subagentReading(subagent) !== ESubagentReading.Settled

const instantOf = (iso: string): number | null => {
  const at = Date.parse(iso)
  return Number.isNaN(at) ? null : at
}

export function subagentElapsedMs(args: {
  subagent: Pick<SubagentReadout, 'startedAt' | 'endedAt'>
  now: number
}): number | null {
  const started = instantOf(args.subagent.startedAt)
  if (started === null) return null

  const ended = args.subagent.endedAt === null ? null : instantOf(args.subagent.endedAt)
  return Math.max(0, (ended ?? args.now) - started)
}

const READOUT_SEPARATOR = ' · '

const stateWord = (subagent: Pick<SubagentReadout, 'status'>): string =>
  SUBAGENT_STATE_LABEL[subagent.status]

type ReadoutParts = { subagent: SubagentReadout; since: string | null }

const SUBAGENT_READOUT: Record<
  ESubagentReading,
  (parts: ReadoutParts) => readonly (string | null)[]
> = {
  [ESubagentReading.Live]: ({ since }) => [since],
  [ESubagentReading.Held]: ({ subagent, since }) => [stateWord(subagent), since],
  [ESubagentReading.Settled]: ({ subagent }) =>
    subagent.status === EAgentStatus.Finished ? [] : [stateWord(subagent)],
}

export function subagentStateLabel(args: { subagent: SubagentReadout; now: number }): string {
  const { subagent } = args
  const elapsed = subagentElapsedMs({ subagent, now: args.now })
  const parts = SUBAGENT_READOUT[subagentReading(subagent)]({
    subagent,
    since: elapsed === null ? null : formatElapsed(elapsed),
  })

  const written = parts.filter((part): part is string => part !== null).join(READOUT_SEPARATOR)
  if (written !== '') return written

  return subagentReading(subagent) === ESubagentReading.Settled ? '' : stateWord(subagent)
}

/**
 * A child's own window, never added to the parent's: a child may run a different model, so the two
 * are different windows and a sum of them would make the parent's remaining context read as a lie.
 */
export function subagentContextLabel(context: ChildContext | undefined): string | null {
  if (context === undefined) return null

  return formatTokens(context.tokens)
}

export function crewActivityOf(args: {
  id: ThreadId
  rosters: CrewRosters
}): CrewActivity | undefined {
  const shells = args.rosters.shells.filter(
    (shell) => shell.threadId === args.id && shell.status === EShellStatus.Running,
  ).length
  const subagents = args.rosters.children.filter(
    (child) => child.spawnedBy === args.id && isSubagentRunning(child),
  ).length

  if (shells === 0 && subagents === 0) return undefined
  return { shells, subagents }
}

export function crewRowReading(subagent: Pick<SidebarSubagent, 'status' | 'activity'>): ESubagentReading {
  const reading = subagentReading(subagent)
  if (reading === ESubagentReading.Settled && subagent.activity !== undefined) {
    return ESubagentReading.Live
  }
  return reading
}

export function subagentRows(args: {
  snapshots: readonly AgentSnapshot[]
  now: number
  modelLabel?: ((model: ProviderIdentity) => string) | undefined
  viewing?: string | null | undefined
  rosters: CrewRosters
}): readonly SidebarSubagent[] {
  return args.snapshots.map((snapshot) => {
    const readout: SubagentReadout = {
      status: snapshot.status,
      startedAt: snapshot.startedAt,
      endedAt: snapshot.endedAt ?? null,
    }

    const activity = crewActivityOf({ id: snapshot.agentId, rosters: args.rosters })

    return {
      ...readout,
      id: snapshot.agentId,
      name: subagentLabel(snapshot),
      agentType: snapshot.agentType,
      state: subagentStateLabel({ subagent: readout, now: args.now }),
      model:
        snapshot.model === undefined
          ? null
          : (args.modelLabel?.(snapshot.model) ?? snapshot.model.modelId),
      context: snapshot.context,
      selected: snapshot.agentId === args.viewing,
      activity,
    }
  })
}
