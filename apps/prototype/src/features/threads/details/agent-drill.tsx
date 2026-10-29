import { AgentsPanel, type AgentsPanelAgent } from '@dltech/atlas-ui/ai/agents-panel'

export function AgentDrill(props: {
  agents: AgentsPanelAgent[]
  detailId: string
  onDetailChange: (id: string | undefined) => void
  onJumpToSpawn: (id: string) => void
}) {
  return (
    <AgentsPanel
      agents={props.agents}
      teammates={[]}
      detailId={props.detailId}
      onDetailChange={props.onDetailChange}
      onOpenTeammate={() => undefined}
      onJumpToSpawn={props.onJumpToSpawn}
    />
  )
}
