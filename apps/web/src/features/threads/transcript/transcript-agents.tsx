'use client'

import { EAgentStatus } from '@dltech/atlas-core'
import { EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'
import { MessageResponse } from '@dltech/atlas-ui/ai/message-response'
import { Subagent } from '@dltech/atlas-ui/ai/subagent'
import { SubagentReports } from '@dltech/atlas-ui/ai/subagent-report'
import { formatElapsed } from '@dltech/atlas-client/transcript'
import { Button } from '@dltech/atlas-ui/components/button'

import { spanMsOf } from '../data/clock-time'
import { spawnDomId, type ReportItem, type SpawnItem } from '../data/transcript-agents'

function outcomeOf(item: SpawnItem) {
  if (item.status === EAgentStatus.Running) return undefined
  if (item.errorText !== undefined) return <p className="text-destructive">{item.errorText}</p>
  if (item.result === undefined) return undefined
  return <MessageResponse>{item.result}</MessageResponse>
}

export function SpawnCard({
  item,
  model,
  now,
  onOpenAgent,
}: {
  item: SpawnItem
  model: string | undefined
  now: number
  onOpenAgent: ((id: string) => void) | null
}) {
  const running = item.status === EAgentStatus.Running
  const handleShowAll = () => onOpenAgent?.(item.agentId)
  const elapsed = formatElapsed(
    spanMsOf({ startedAt: item.at, endedAt: item.endedAt, now, running }),
  )
  return (
    <div id={spawnDomId(item.agentId)} className="-m-1 rounded-md p-1">
      <Subagent
        name={`${item.agentType} (${item.intent})`}
        running={running}
        elapsed={elapsed}
        model={model}
        prompt={item.brief}
        result={
          <div className="flex flex-col items-start gap-3">
            {outcomeOf(item)}
            {onOpenAgent === null ? null : (
              <Button variant="ghost" size="xs" onClick={handleShowAll}>
                Show in agent detail
              </Button>
            )}
          </div>
        }
        defaultOpen={false}
      />
    </div>
  )
}

export function ReportNotice({
  item,
  onOpenAgent,
}: {
  item: ReportItem
  onOpenAgent: ((id: string) => void) | null
}) {
  return (
    <SubagentReports
      reports={[
        {
          id: item.agentId,
          agentType: item.agentType,
          intent: item.intent,
          display: item.failed ? EAgentDisplay.Failed : EAgentDisplay.Done,
          elapsed: item.elapsed,
          report: item.report,
          errorText: item.errorText,
        },
      ]}
      onOpen={onOpenAgent ?? undefined}
    />
  )
}
