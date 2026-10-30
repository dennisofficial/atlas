import {
  EKilledBy,
  EPlanStatus,
  EServiceStatus,
  type Event,
  type FoldableService,
  type SpendTally,
} from '@dltech/atlas-core'
import {
  EServiceStatus as EWireServiceStatus,
  type ServiceSnapshotWire,
} from '@dltech/atlas-wire/web'

const THOUSAND = 1_000
const MILLION = 1_000_000
const BILLION = 1_000_000_000

export function formatTokens(tokens: number): string {
  if (tokens < THOUSAND) return String(tokens)
  if (tokens < MILLION) return `${(tokens / THOUSAND).toFixed(1)}k`
  if (tokens < BILLION) return `${(tokens / MILLION).toFixed(2)}m`
  return `${(tokens / BILLION).toFixed(2)}b`
}

export const turnCountOf = (events: readonly Event[]): number =>
  events.filter((event) => event.type === 'user-said').length

export const turnsLabelOf = (turns: number): string => `${turns} ${turns === 1 ? 'turn' : 'turns'}`

export function tokenFiguresOf(spend: SpendTally): string | null {
  if (spend.inputTokens === 0 && spend.outputTokens === 0) return null
  const figures = [
    `↑ ${formatTokens(spend.uncachedInputTokens)}`,
    `↓ ${formatTokens(spend.outputTokens)}`,
  ]
  if (spend.cacheReadTokens > 0) figures.push(`cache ${formatTokens(spend.cacheReadTokens)}`)
  return figures.join('  ')
}

export const planCountOf = (tasks: readonly { status: EPlanStatus }[]): string =>
  `${tasks.filter((task) => task.status === EPlanStatus.Completed).length}/${tasks.length}`

export const planDoneLabelOf = (args: { hidden: number; expanded: boolean }): string =>
  args.expanded ? 'Show fewer' : `${args.hidden} earlier done`

const SERVICE_STATUS: Record<EWireServiceStatus, EServiceStatus> = {
  [EWireServiceStatus.Running]: EServiceStatus.Running,
  [EWireServiceStatus.Exited]: EServiceStatus.Exited,
  [EWireServiceStatus.Killed]: EServiceStatus.Killed,
}

export type KeptService = FoldableService & { snapshot: ServiceSnapshotWire }

export const keptServiceOf = (snapshot: ServiceSnapshotWire): KeptService => ({
  serviceId: snapshot.serviceId,
  status: SERVICE_STATUS[snapshot.status],
  exitCode: snapshot.exitCode,
  killedBy: Object.values(EKilledBy).find((killed) => String(killed) === snapshot.killedBy),
  snapshot,
})

export const earlierLabelOf = (args: { hidden: number; failed: boolean }): string =>
  `+${args.hidden} earlier${args.failed ? ' · one failed' : ''}`

export const settledLabelOf = (args: {
  collapsed: number
  expanded: boolean
  failed: boolean
}): string =>
  args.expanded ? 'Show fewer' : `${args.collapsed} settled${args.failed ? ' · one failed' : ''}`
