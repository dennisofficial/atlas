import { EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'

import type { AppTeammate } from '../../shell/fixtures/teammates'
import { teammateDisplay } from '../../shell/teammate-display'
import type { AgentRun } from '../agent-run'
import type { CrewRow } from './details-model'

const EARLIER: CrewRow[] = [
  {
    id: 'sa-earlier-1',
    title: 'Scan token usage',
    subtitle: 'explore',
    display: EAgentDisplay.Done,
  },
  {
    id: 'sa-earlier-2',
    title: 'List story gaps',
    subtitle: 'explore',
    display: EAgentDisplay.Done,
  },
]

export function teammateRowsOf(teammates: AppTeammate[]): CrewRow[] {
  return teammates.map((teammate) => ({
    id: teammate.id,
    title: teammate.title,
    display: teammateDisplay(teammate),
  }))
}

export function subagentRowsOf(agents: AgentRun[]): CrewRow[] {
  if (agents.length === 0) return []
  const rows = agents.map((agent) => ({
    id: agent.id,
    title: agent.intent,
    subtitle: agent.agentType,
    display: agent.display,
  }))
  const failed = rows.filter((row) => row.display === EAgentDisplay.Failed)
  const rest = rows.filter((row) => row.display !== EAgentDisplay.Failed)
  const [first = [], second = []] = [EARLIER.slice(0, 1), EARLIER.slice(1)]
  return [...failed, ...first, ...second, ...rest]
}
