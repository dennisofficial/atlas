import { ChatItem } from '@dltech/atlas-ui/ai/chat'
import { AgentMessage, UserMessage } from '@dltech/atlas-ui/ai/message'
import { MessageResponse } from '@dltech/atlas-ui/ai/message-response'
import { Subagent } from '@dltech/atlas-ui/ai/subagent'
import { SubagentReports } from '@dltech/atlas-ui/ai/subagent-report'
import { EToolKind } from '@dltech/atlas-ui/ai/tool'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { toReportEntry } from './agent-adapters'
import { type AgentRun, isLiveAgent } from './agent-run'
import { SPAWN_PROMPT, SPAWN_REPLY } from './transcript-data'
import { spawnDomId } from './use-spawn-flash'

const MAX_VISIBLE_CALLS = 5

export interface AgentTurnsProps {
  agents: AgentRun[]
  flashId?: string
  onOpenAgent: (id: string) => void
}

function resultOf(run: AgentRun) {
  if (isLiveAgent(run)) return undefined
  if (run.errorText !== undefined) return <p className="text-destructive">{run.errorText}</p>
  return <MessageResponse>{run.report ?? ''}</MessageResponse>
}

function toolKindsOf(run: AgentRun): string[] {
  return [...new Set(run.calls.map((call) => call.kind ?? EToolKind.Shell))]
}

interface SpawnedAgentProps {
  run: AgentRun
  flashed: boolean
  onOpenAgent: (id: string) => void
}

function SpawnedAgent({ run, flashed, onOpenAgent }: SpawnedAgentProps) {
  const handleShowAll = () => onOpenAgent(run.id)
  return (
    <div
      id={spawnDomId(run.id)}
      className={cn(
        '-m-1 rounded-md p-1 transition-shadow duration-300',
        flashed && 'ring-2 ring-ring',
      )}
    >
      <Subagent
        name={`${run.agentType} (${run.intent})`}
        running={isLiveAgent(run)}
        elapsed={run.elapsed}
        model={run.model}
        tools={toolKindsOf(run)}
        prompt={run.brief}
        calls={run.calls}
        maxVisibleCalls={MAX_VISIBLE_CALLS}
        onShowAllCalls={handleShowAll}
        result={resultOf(run)}
        defaultOpen={false}
      />
    </div>
  )
}

export function SpawnTurn({ agents, flashId, onOpenAgent }: AgentTurnsProps) {
  return (
    <>
      <ChatItem id="u-spawn">
        <UserMessage author="Dennis" timestamp="14:38">
          {SPAWN_PROMPT}
        </UserMessage>
      </ChatItem>
      <ChatItem id="a-spawn">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            {agents.map((run) => (
              <SpawnedAgent
                key={run.id}
                run={run}
                flashed={run.id === flashId}
                onOpenAgent={onOpenAgent}
              />
            ))}
          </div>
          <AgentMessage author="Atlas" timestamp="14:39">
            {SPAWN_REPLY}
          </AgentMessage>
        </div>
      </ChatItem>
    </>
  )
}

export interface ReportNoticeProps {
  id: string
  runs: AgentRun[]
  onOpenAgent: (id: string) => void
}

export function ReportNotice({ id, runs, onOpenAgent }: ReportNoticeProps) {
  if (runs.length === 0) return null
  return (
    <ChatItem id={id}>
      <SubagentReports reports={runs.map(toReportEntry)} onOpen={onOpenAgent} />
    </ChatItem>
  )
}
