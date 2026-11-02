import { useState } from 'react'

import { AgentStatusIcon, EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@dltech/atlas-ui/components/table'

import { DENSE_SUBAGENTS, type DenseAgent } from './dense-fixtures'
import { isWorking, settledLabelOf } from './details-model'
import { DetailsSection } from './section'
import { BODY_CELL, HEAD_CELL, MID_COLUMN, Mono, ToggleRow } from './table-parts'

const SETTLED_SHOWN = 3

function isSettled(agent: DenseAgent): boolean {
  return agent.display === EAgentDisplay.Done || agent.display === EAgentDisplay.Failed
}

function foldAgents(expanded: boolean) {
  const settled = DENSE_SUBAGENTS.filter(isSettled)
  const folded = settled.slice(0, Math.max(0, settled.length - SETTLED_SHOWN))
  const foldedIds = new Set(folded.map((agent) => agent.id))
  return {
    rows: expanded ? DENSE_SUBAGENTS : DENSE_SUBAGENTS.filter((agent) => !foldedIds.has(agent.id)),
    collapsed: folded.length,
    failed: folded.some((agent) => agent.display === EAgentDisplay.Failed),
  }
}

function AgentRow({ agent }: { agent: DenseAgent }) {
  return (
    <TableRow>
      <TableCell className={`${BODY_CELL} w-6`}>
        <span className="flex size-4 items-center justify-center">
          <AgentStatusIcon display={agent.display} />
        </span>
      </TableCell>
      <TableCell className={`${BODY_CELL} w-full max-w-0`}>
        <span className="block truncate text-sm" title={agent.title}>
          {agent.title}
        </span>
        <span className="block truncate text-xs text-muted-foreground tabular-nums @[480px]:hidden">
          {agent.model} · {agent.elapsed}
        </span>
      </TableCell>
      <TableCell className={`${BODY_CELL} ${MID_COLUMN} text-xs text-muted-foreground`}>
        {agent.model}
      </TableCell>
      <TableCell className={`${BODY_CELL} ${MID_COLUMN} text-right`}>
        <Mono>{agent.elapsed}</Mono>
      </TableCell>
      <TableCell className={`${BODY_CELL} text-right`}>
        <Mono>{agent.tokens}</Mono>
      </TableCell>
    </TableRow>
  )
}

export function AgentsTable() {
  const [expanded, setExpanded] = useState(false)
  const fold = foldAgents(expanded)
  const working = DENSE_SUBAGENTS.filter((agent) => isWorking(agent.display)).length

  return (
    <DetailsSection title="Sub-agents" count={`${working}/${DENSE_SUBAGENTS.length}`}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={HEAD_CELL}>
              <span className="sr-only">Status</span>
            </TableHead>
            <TableHead className={HEAD_CELL}>Title</TableHead>
            <TableHead className={`${HEAD_CELL} ${MID_COLUMN}`}>Model</TableHead>
            <TableHead className={`${HEAD_CELL} ${MID_COLUMN} text-right`}>Elapsed</TableHead>
            <TableHead className={`${HEAD_CELL} text-right`}>Tokens</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fold.rows.map((agent) => (
            <AgentRow key={agent.id} agent={agent} />
          ))}
          {fold.collapsed > 0 ? (
            <ToggleRow
              colSpan={5}
              label={settledLabelOf({
                collapsed: fold.collapsed,
                expanded,
                failed: fold.failed,
              })}
              onToggle={() => setExpanded((held) => !held)}
            />
          ) : null}
        </TableBody>
      </Table>
    </DetailsSection>
  )
}
