import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { ArrowLeftIcon, ArrowUpToLineIcon } from 'lucide-react'

import { Badge } from '#components/badge'
import { Button } from '#components/button'
import { AgentStatusIcon, EAgentDisplay, agentDisplayLabel } from '../agent-status'
import { EDetailRow, detailRows, toolCallsLabel, type DetailRow } from '../agents-panel-detail-rows'
import { formatContext } from '../agents-panel-format'
import { isRunningDisplay } from '../agents-panel-groups'
import type { AgentsPanelAgent } from '../agents-panel-types'
import { AgentMessage } from '../message'
import { Tool } from '../tool'
import { useStickToBottom } from './use-stick-to-bottom'

function DetailHeader({ agent }: { agent: AgentsPanelAgent }) {
  const failed = agent.display === EAgentDisplay.Failed
  return (
    <div className="flex flex-col gap-2 border-b px-4 pb-3">
      <h2 className="flex min-w-0 items-center gap-2 text-base font-medium">
        <AgentStatusIcon display={agent.display} />
        <span className="shrink-0 font-mono text-xs font-normal text-muted-foreground">
          {agent.agentType}
        </span>
        <span className="min-w-0 truncate">{agent.intent}</span>
      </h2>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant={failed ? 'destructive' : 'secondary'}>
          {agentDisplayLabel(agent.display)}
        </Badge>
        <span>{agent.model}</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">{agent.elapsed}</span>
        {agent.context ? (
          <>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{formatContext(agent.context)}</span>
          </>
        ) : null}
      </div>
    </div>
  )
}

function Outcome({ agent }: { agent: AgentsPanelAgent }) {
  if (agent.display === EAgentDisplay.Failed) {
    return (
      <AgentMessage author="Error">
        <p className="text-destructive">{agent.errorText}</p>
      </AgentMessage>
    )
  }
  return <AgentMessage author="Report">{agent.report}</AgentMessage>
}

const ROW_ESTIMATE: Record<EDetailRow, number> = {
  [EDetailRow.Brief]: 96,
  [EDetailRow.CallsLabel]: 24,
  [EDetailRow.Call]: 28,
  [EDetailRow.Outcome]: 96,
}

const ROW_SPACING: Record<EDetailRow, string> = {
  [EDetailRow.Brief]: 'pb-5',
  [EDetailRow.CallsLabel]: 'pb-2',
  [EDetailRow.Call]: 'pb-1',
  [EDetailRow.Outcome]: 'pt-4 pb-6',
}

const OVERSCAN = 8
const INITIAL_VIEWPORT_HEIGHT = 640

interface RowContentProps {
  row: DetailRow
  agent: AgentsPanelAgent
}

function RowContent({ row, agent }: RowContentProps) {
  if (row.kind === EDetailRow.Brief) {
    return (
      <AgentMessage author="Brief from Atlas">
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-muted-foreground">
          {agent.brief}
        </p>
      </AgentMessage>
    )
  }
  if (row.kind === EDetailRow.CallsLabel) {
    return (
      <span className="text-xs font-medium text-muted-foreground tabular-nums">
        {toolCallsLabel(row.count)}
      </span>
    )
  }
  if (row.kind === EDetailRow.Call) return <Tool {...row.call} />
  return <Outcome agent={agent} />
}

function DetailList({ agent }: { agent: AgentsPanelAgent }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stuckRef = useStickToBottom(scrollRef)
  const rows = useMemo(() => detailRows({ agent }), [agent])
  const running = isRunningDisplay(agent.display)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => ROW_ESTIMATE[rows[index]?.kind ?? EDetailRow.Call],
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: OVERSCAN,
    initialRect: { width: 0, height: INITIAL_VIEWPORT_HEIGHT },
  })

  useEffect(() => {
    if (!running || !stuckRef.current || rows.length === 0) return
    virtualizer.scrollToIndex(rows.length - 1, { align: 'end' })
  }, [running, rows.length, stuckRef, virtualizer])

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]
          if (!row) return null
          return (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className={`absolute top-0 left-0 w-full ${ROW_SPACING[row.kind]}`}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <RowContent row={row} agent={agent} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface AgentsPanelDetailProps {
  agent: AgentsPanelAgent
  onBack: () => void
  onJumpToSpawn: (id: string) => void
  renderTranscript?: ((agent: AgentsPanelAgent) => ReactNode) | undefined
}

export function AgentsPanelDetail({
  agent,
  onBack,
  onJumpToSpawn,
  renderTranscript,
}: AgentsPanelDetailProps) {
  const handleJump = () => onJumpToSpawn(agent.id)
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 pt-2">
      <div className="flex items-center justify-between px-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeftIcon />
          All agents
        </Button>
        <Button variant="ghost" size="sm" onClick={handleJump}>
          <ArrowUpToLineIcon />
          Jump to spawn
        </Button>
      </div>
      <DetailHeader agent={agent} />
      {renderTranscript ? (
        <div className="flex min-h-0 flex-1 flex-col">{renderTranscript(agent)}</div>
      ) : (
        <DetailList agent={agent} />
      )}
    </div>
  )
}
