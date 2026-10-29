import { useState } from 'react'

import { AgentStatusIcon } from '@dltech/atlas-ui/ai/agent-status'

import { foldCrew, isWorking, settledLabelOf, type CrewRow } from './details-model'
import { DetailsSection, RowButton } from './section'

function CrewGroup(props: { title: string; rows: CrewRow[]; onOpen: (row: CrewRow) => void }) {
  const [expanded, setExpanded] = useState(false)
  const { rows } = props
  if (rows.length === 0) return null
  const fold = foldCrew({ rows, expanded })
  const working = rows.filter((row) => isWorking(row.display)).length

  return (
    <DetailsSection title={props.title} count={`${working}/${rows.length}`}>
      {fold.shown.map((row) => (
        <RowButton key={row.id} onClick={() => props.onOpen(row)}>
          <AgentStatusIcon display={row.display} />
          <span className="min-w-0 flex-1 truncate text-left">{row.title}</span>
          {row.subtitle === undefined ? null : (
            <span className="shrink-0 text-xs text-muted-foreground">{row.subtitle}</span>
          )}
        </RowButton>
      ))}
      {fold.collapsed > 0 ? (
        <RowButton onClick={() => setExpanded((held) => !held)}>
          <span className="text-xs text-muted-foreground">
            {settledLabelOf({
              collapsed: fold.collapsed,
              expanded,
              failed: fold.collapsedFailed,
            })}
          </span>
        </RowButton>
      ) : null}
    </DetailsSection>
  )
}

export function CrewSection(props: {
  teammates: CrewRow[]
  subagents: CrewRow[]
  onOpenTeammate: (id: string) => void
  onOpenAgent: (id: string) => void
}) {
  return (
    <>
      <CrewGroup
        title="Teammates"
        rows={props.teammates}
        onOpen={(row) => props.onOpenTeammate(row.id)}
      />
      <CrewGroup
        title="Sub-agents"
        rows={props.subagents}
        onOpen={(row) => props.onOpenAgent(row.id)}
      />
    </>
  )
}
