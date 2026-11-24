import type { PlanTask, SpendTally } from '@dltech/atlas-core'
import { EServiceStatus, EShellStatus } from '@dltech/atlas-core'
import { crewOfView, type CrewRow } from '@dltech/atlas-plugin-crew/client'
import { planOfView } from '@dltech/atlas-plugin-sessions/client'
import {
  previewsOfView,
  servicesOfView,
  type PreviewItem,
} from '@dltech/atlas-plugin-services/client'
import { shellsOfView } from '@dltech/atlas-plugin-shells/client'
import type { ServiceRow as ServiceViewRow } from '@dltech/atlas-plugin-services/core'
import type { ShellRow } from '@dltech/atlas-plugin-shells/core'
import type { SessionViewOutput } from '@dltech/atlas-protocol'

import { TASK_STATE_OF, type SidebarTask } from '../store/sidebar-model'

export type SessionContextReading = {
  used: number | null
  limit: number
  breakdown: readonly { label: string; tokens: number }[]
}

export type SessionPanes = {
  crew: readonly CrewRow[]
  shells: readonly ShellRow[]
  services: readonly ServiceViewRow[]
  previews: readonly PreviewItem[]
  plan: readonly PlanTask[]
  spend: SpendTally | null
  context: SessionContextReading | null
  branch: string | null
  repo: string | null
}

const EMPTY_PANES: SessionPanes = {
  crew: [],
  shells: [],
  services: [],
  previews: [],
  plan: [],
  spend: null,
  context: null,
  branch: null,
  repo: null,
}

type Changed = { status: string; changedAt: string }

const runningFirst = (args: { running: string }): ((left: Changed, right: Changed) => number) => {
  const rank = (status: string): number => (status === args.running ? 0 : 1)
  return (left, right) =>
    rank(left.status) - rank(right.status) || right.changedAt.localeCompare(left.changedAt)
}

export const orderedShellRows = (rows: readonly ShellRow[]): readonly ShellRow[] =>
  [...rows].sort(runningFirst({ running: EShellStatus.Running }))

export const orderedServiceRows = (rows: readonly ServiceViewRow[]): readonly ServiceViewRow[] =>
  [...rows].sort(runningFirst({ running: EServiceStatus.Running }))

export const contextReadingOf = (
  view: SessionViewOutput | undefined,
): SessionContextReading | null => {
  const context = view?.context
  if (context === null || context === undefined) return null
  if (context.window === null || context.window <= 0) return null

  return { used: context.used, limit: context.window, breakdown: context.breakdown ?? [] }
}

export const planTasksOf = (tasks: readonly PlanTask[]): readonly SidebarTask[] =>
  tasks.map((task) => ({
    id: String(task.ordinal),
    label: task.text,
    state: TASK_STATE_OF[task.status],
    ...(task.activeForm === undefined ? {} : { activeForm: task.activeForm }),
  }))

export const branchOf = (view: SessionViewOutput | undefined): string | null =>
  view?.checkouts.primary?.branch ?? null

export const repoOf = (view: SessionViewOutput | undefined): string | null =>
  view?.checkouts.primary?.repo ?? null

export const panesOfView = (view: SessionViewOutput | undefined): SessionPanes => {
  if (view === undefined) return EMPTY_PANES

  return {
    crew: crewOfView(view.pluginViews),
    shells: orderedShellRows(shellsOfView(view.pluginViews)),
    services: orderedServiceRows(servicesOfView(view.pluginViews)),
    previews: previewsOfView(view.pluginViews),
    plan: planOfView(view.pluginViews),
    spend: view.spend.tally,
    context: contextReadingOf(view),
    branch: branchOf(view),
    repo: repoOf(view),
  }
}
