'use client'

import { isActiveCrewStatus } from '@dltech/atlas-plugin-crew/client'
import { formatElapsed } from '@dltech/atlas-client/transcript'

import { AgentStatusIcon } from '@/features/shell/shell-status-icon'
import { useNowEvery } from '@/features/threads/data/use-now'
import { useOptionalThreadPanel } from '@/features/threads/panel/thread-panel-context'

import { useSessionPaneValue } from '../pane-value'
import { FoldedRows, Row, SectionHead } from './rows'
import { Reveal } from './reveal'

const TICK_MS = 30_000

export function SessionCrewSection() {
  const { view } = useSessionPaneValue()
  const openAgent = useOptionalThreadPanel()?.openAgent
  const active = view.crewRows.filter((row) => isActiveCrewStatus(row.status)).length
  const count =
    view.crew.running > 0 ? (
      <span className="flex items-baseline gap-2">
        <span className="text-foreground">{view.crew.running} running</span>
        <span>{view.crew.total}</span>
      </span>
    ) : (
      view.crew.total
    )
  const now = useNowEvery({ enabled: view.crewRows.length > 0, tickMs: TICK_MS })
  return (
    <Reveal open={view.crewRows.length > 0} section>
      <section data-session-crew aria-label="Sub-agents" className="flex flex-col">
        <SectionHead title="Sub-agents" count={count} />
        <FoldedRows
          rows={view.crewRows}
          minVisible={active}
          rowKey={(row) => row.agentId}
          render={(row) => {
            const end = row.endedAt === undefined ? now : Date.parse(row.endedAt)
            const started = Date.parse(row.startedAt)
            const elapsed = Number.isNaN(started) ? null : formatElapsed(Math.max(0, end - started))
            return (
              <Row
                key={row.agentId}
                leading={<AgentStatusIcon status={row.status} />}
                title={row.agentType}
                meta={row.intent}
                trailing={elapsed}
                label={`Open the ${row.agentType} sub-agent: ${row.intent}`}
                onSelect={openAgent === undefined ? undefined : () => openAgent(row.agentId)}
              />
            )
          }}
        />
      </section>
    </Reveal>
  )
}
