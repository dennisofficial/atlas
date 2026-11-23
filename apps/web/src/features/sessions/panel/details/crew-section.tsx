'use client'

import { EAgentStatus } from '@dltech/atlas-core'
import { formatElapsed } from '@dltech/atlas-client/transcript'

import { useNowEvery } from '@/features/threads/data/use-now'
import { useOptionalThreadPanel } from '@/features/threads/panel/thread-panel-context'

import { useSessionPaneValue } from '../pane-value'
import { Dot, EmptyLine, FoldedRows, Row, SectionHead } from './rows'

const CREW_TONE: Record<EAgentStatus, string> = {
  [EAgentStatus.Running]: 'bg-success',
  [EAgentStatus.Finished]: 'bg-muted-foreground/40',
  [EAgentStatus.Failed]: 'bg-destructive',
  [EAgentStatus.Stopped]: 'bg-muted-foreground/40',
  [EAgentStatus.Blocked]: 'bg-warning',
  [EAgentStatus.Paused]: 'bg-muted-foreground/40',
  [EAgentStatus.WaitingForModel]: 'bg-warning',
}

const TICK_MS = 30_000

export function SessionCrewSection() {
  const { view } = useSessionPaneValue()
  const openAgent = useOptionalThreadPanel()?.openAgent
  const now = useNowEvery({ enabled: view.crewRows.length > 0, tickMs: TICK_MS })
  if (view.crew.total === 0)
    return (
      <section data-session-crew aria-label="Sub-agents" className="flex flex-col">
        <SectionHead title="Sub-agents" />
        <EmptyLine>No sub-agents yet</EmptyLine>
      </section>
    )
  return (
    <section data-session-crew aria-label="Sub-agents" className="flex flex-col">
      <SectionHead title="Sub-agents" count={view.crew.total} />
      <FoldedRows
        rows={view.crewRows}
        render={(row) => {
          const end = row.endedAt === undefined ? now : Date.parse(row.endedAt)
          const started = Date.parse(row.startedAt)
          const elapsed = Number.isNaN(started) ? null : formatElapsed(Math.max(0, end - started))
          return (
            <Row
              key={row.agentId}
              leading={<Dot className={CREW_TONE[row.status]} />}
              title={row.agentType}
              meta={row.intent}
              trailing={elapsed === null ? null : <span className="font-mono">{elapsed}</span>}
              label={`Open the ${row.agentType} sub-agent: ${row.intent}`}
              onSelect={openAgent === undefined ? undefined : () => openAgent(row.agentId)}
            />
          )
        }}
      />
    </section>
  )
}
