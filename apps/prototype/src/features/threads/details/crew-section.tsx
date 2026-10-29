import { useState } from 'react'

import { AgentStatusIcon } from '@dltech/atlas-ui/ai/agent-status'
import { DetailRow } from '@dltech/atlas-ui/ai/detail-row'

import { foldCrew, isWorking, settledLabelOf, type CrewRow } from './details-model'
import { DetailsSection } from './section'

function CrewGroup(props: { title: string; rows: CrewRow[]; onOpen: (row: CrewRow) => void }) {
  const [expanded, setExpanded] = useState(false)
  const { rows } = props
  if (rows.length === 0) return null
  const fold = foldCrew({ rows, expanded })
  const working = rows.filter((row) => isWorking(row.display)).length

  return (
    <DetailsSection title={props.title} count={`${working}/${rows.length}`}>
      {fold.shown.map((row) => (
        <DetailRow
          key={row.id}
          icon={<AgentStatusIcon display={row.display} />}
          label={row.title}
          meta={row.subtitle}
          onClick={() => props.onOpen(row)}
        />
      ))}
      {fold.collapsed > 0 ? (
        <DetailRow
          onClick={() => setExpanded((held) => !held)}
          label={
            <span className="text-xs text-muted-foreground">
              {settledLabelOf({
                collapsed: fold.collapsed,
                expanded,
                failed: fold.collapsedFailed,
              })}
            </span>
          }
        />
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
