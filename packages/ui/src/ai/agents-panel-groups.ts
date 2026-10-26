import { EAgentDisplay } from './agent-status'
import type { AgentsPanelAgent } from './agents-panel-types'

export const DONE_PREVIEW_COUNT = 5

const RUNNING_DISPLAYS: ReadonlySet<EAgentDisplay> = new Set([
  EAgentDisplay.Running,
  EAgentDisplay.StartingSandbox,
  EAgentDisplay.NeedsApproval,
  EAgentDisplay.Paused,
])

export function isRunningDisplay(display: EAgentDisplay): boolean {
  return RUNNING_DISPLAYS.has(display)
}

export function runningAgents(agents: AgentsPanelAgent[]): AgentsPanelAgent[] {
  return agents.filter((agent) => isRunningDisplay(agent.display))
}

export function runningAgentCount(agents: AgentsPanelAgent[]): number {
  return runningAgents(agents).length
}

export function doneAgents(agents: AgentsPanelAgent[]): AgentsPanelAgent[] {
  return agents
    .filter((agent) => !isRunningDisplay(agent.display))
    .sort((left, right) => (right.endedAt ?? 0) - (left.endedAt ?? 0))
}

export function hiddenDoneCount(done: AgentsPanelAgent[]): number {
  return Math.max(0, done.length - DONE_PREVIEW_COUNT)
}

interface VisibleDoneInput {
  done: AgentsPanelAgent[]
  expanded: boolean
}

export function visibleDone({ done, expanded }: VisibleDoneInput): AgentsPanelAgent[] {
  return expanded ? done : done.slice(0, DONE_PREVIEW_COUNT)
}

export function showMoreLabel(count: number): string {
  return `Show ${count} more`
}
