import { EAgentStatus, contextPressure, type ProviderIdentity } from '@dltech/atlas-core'
import type { AgentSnapshot, ChildContext } from '@dltech/atlas-harness'

import { truncateCells } from '../ui/components/sidebar/cells'
import { formatElapsed } from '../ui/theme'
import { TITLE_CELLS, oneLineOf } from './sidebar-text'

export type SubagentReadout = {
  status: EAgentStatus
  lastTool: string | null
  startedAt: string
  endedAt: string | null
}

export type SidebarSubagent = SubagentReadout & {
  id: string
  name: string
  state: string
  model: string | null
  context?: ChildContext | undefined
  selected: boolean
}

export type SidebarCrewFold = { hidden: number; hiddenFailed: boolean }

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
 * What the narrow value column spends its cells on. A child that is still going is judged by what
 * it is doing and for how long; one that has settled is judged by its outcome alone.
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
  [ESubagentReading.Live]: ({ subagent, since }) => [subagent.lastTool, since],
  [ESubagentReading.Held]: ({ subagent, since }) => [stateWord(subagent), since],
  [ESubagentReading.Settled]: ({ subagent }) => [stateWord(subagent)],
}

export function subagentStateLabel(args: { subagent: SubagentReadout; now: number }): string {
  const { subagent } = args
  const elapsed = subagentElapsedMs({ subagent, now: args.now })
  const parts = SUBAGENT_READOUT[subagentReading(subagent)]({
    subagent,
    since: elapsed === null ? null : formatElapsed(elapsed),
  })

  const written = parts.filter((part): part is string => part !== null).join(READOUT_SEPARATOR)
  return written === '' ? stateWord(subagent) : written
}

export const FIGURE_SEPARATOR = '  '

/**
 * A child's own window, never added to the parent's: a child may run a different model, so the two
 * are different windows and a sum of them would make the parent's remaining context read as a lie.
 * A window nothing has sized is unreadable rather than empty.
 */
export function subagentContextLabel(context: ChildContext | undefined): string | null {
  if (context === undefined) return null
  if (context.window <= 0) return null

  const pressure = contextPressure({ used: context.tokens, window: context.window })
  return `ctx ${pressure.percent}%`
}

/**
 * The second line: which model the child runs and how full its own window has got. A child whose
 * model this process never observed — one recovered from the log — shows its window alone.
 */
export function subagentFigures(
  subagent: Pick<SidebarSubagent, 'model' | 'context'>,
): string | null {
  const written = [subagent.model, subagentContextLabel(subagent.context)]
    .filter((figure): figure is string => figure !== null)
    .join(FIGURE_SEPARATOR)

  return written === '' ? null : written
}

export function subagentRows(args: {
  snapshots: readonly AgentSnapshot[]
  now: number
  modelLabel?: ((model: ProviderIdentity) => string) | undefined
  viewing?: string | null | undefined
}): readonly SidebarSubagent[] {
  return args.snapshots.map((snapshot) => {
    const readout: SubagentReadout = {
      status: snapshot.status,
      lastTool: snapshot.lastTool ?? null,
      startedAt: snapshot.startedAt,
      endedAt: snapshot.endedAt ?? null,
    }

    return {
      ...readout,
      id: snapshot.agentId,
      name: subagentLabel(snapshot),
      state: subagentStateLabel({ subagent: readout, now: args.now }),
      model:
        snapshot.model === undefined
          ? null
          : (args.modelLabel?.(snapshot.model) ?? snapshot.model.modelId),
      context: snapshot.context,
      selected: snapshot.agentId === args.viewing,
    }
  })
}
