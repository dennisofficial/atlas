import React from 'react'

import { crewTiersOf, type SidebarTeammate } from '../../../store/sidebar-model'
import {
  isSubagentRunning,
  subagentContextLabel,
  subagentReading,
  type SidebarCrewFold,
  type SidebarSubagent,
} from '../../../store/subagent-row'
import { plural } from '../../../store/tools/reading'
import { contextUsageTone } from '../../context-bar'
import { usePress } from '../../hooks/use-press'
import { MARK_OF, NAME_INK_OF, STATE_INK_OF } from '../../subagent-ink'
import { glyph, theme } from '../../theme'
import { Spans, type Span } from '../spans'
import { justifySpans } from './cells'
import { Row, Section } from './row'

const IDLE = 'idle'

/** A mark and the space after it, so the second line's model sits where the title sits. */
const TITLE_INDENT = '  '

const markFor = (subagent: SidebarSubagent) => MARK_OF[subagentReading(subagent)]

const labelFor = (subagent: SidebarSubagent): string => {
  if (subagent.selected) return theme.court.external
  return NAME_INK_OF[subagentReading(subagent)]
}

const valueFor = (subagent: SidebarSubagent) => [
  { text: subagent.state, fg: STATE_INK_OF[subagentReading(subagent)] },
]

/**
 * A second line, and only when there is a reading to put on it — the same pair the footer gives
 * the main agent, with the child's own math: the model it runs, lined up under the title, and
 * what its own window holds on the right edge. Worth the row's height in every state — running,
 * blocked and settled alike — but an empty one would spend the height on nothing, which in a
 * panel this narrow is what makes a crew unreadable.
 */
function FiguresLine(props: { subagent: SidebarSubagent; cells: number }): React.ReactNode {
  const context = subagentContextLabel(props.subagent.context)
  if (props.subagent.model === null && context === null) return null

  const model: readonly Span[] =
    props.subagent.model === null
      ? []
      : [{ text: `${TITLE_INDENT}${props.subagent.model}`, fg: theme.dim }]
  const reading: readonly Span[] =
    context === null || props.subagent.context === undefined
      ? []
      : [{ text: context, fg: contextUsageTone(props.subagent.context.tokens) }]

  return (
    <text>
      <Spans spans={justifySpans({ left: model, right: reading, cells: props.cells })} />
    </text>
  )
}

/**
 * What the panel let go of, kept as one line rather than a heading of its own. The reading names
 * `/agents` because a retired child is still whole — the rows leave the sidebar, nothing leaves
 * the roster or the log.
 */
function RetiredLine(props: { fold: SidebarCrewFold; cells: number }): React.ReactNode {
  return (
    <Row
      label={`${plural(props.fold.hidden, 'more')} in /agents`}
      labelFg={theme.rule}
      cells={props.cells}
      mark={{ text: glyph.seen, fg: theme.rule }}
      {...(props.fold.hiddenFailed ? { value: [{ text: 'one failed', fg: theme.warn }] } : {})}
    />
  )
}

/**
 * Selecting a row moves the transcript alone, so the highlight is the only thing that says where
 * the operator is reading — the rest of this panel still describes the thread that spawned them.
 */
function CrewRows(props: {
  subagents: readonly SidebarSubagent[]
  cells: number
  onOpen?: ((agentId: string) => void) | undefined
}): React.ReactNode {
  const press = usePress()

  return (
    <>
      {props.subagents.map((subagent) => (
        <box
          key={subagent.id}
          flexDirection="column"
          flexShrink={0}
          {...(subagent.selected ? { backgroundColor: theme.userBg } : {})}
          {...press(props.onOpen === undefined ? undefined : () => props.onOpen?.(subagent.id))}
        >
          <Row
            label={subagent.name}
            labelFg={labelFor(subagent)}
            cells={props.cells}
            mark={markFor(subagent)}
            value={valueFor(subagent)}
          />
          <FiguresLine subagent={subagent} cells={props.cells} />
        </box>
      ))}
    </>
  )
}

export function SubagentsSection(props: {
  subagents: readonly SidebarSubagent[]
  cells: number
  fold?: SidebarCrewFold | undefined
  onOpen?: (agentId: string) => void
}): React.ReactNode {
  if (props.subagents.length === 0) return null

  const { teammates, subagents } = crewTiersOf(props.subagents)

  return (
    <>
      {teammates.length === 0 ? null : (
        <Section
          label="Teammates"
          count={`${teammates.filter(isSubagentRunning).length}/${teammates.length}`}
        >
          <CrewRows subagents={teammates} cells={props.cells} onOpen={props.onOpen} />
        </Section>
      )}
      {subagents.length === 0 ? null : (
        <Section
          label="Sub-agents"
          count={`${subagents.filter(isSubagentRunning).length}/${subagents.length + (props.fold?.hidden ?? 0)}`}
        >
          <CrewRows subagents={subagents} cells={props.cells} onOpen={props.onOpen} />
          {props.fold === undefined ? null : (
            <RetiredLine fold={props.fold} cells={props.cells} />
          )}
        </Section>
      )}
    </>
  )
}

export function TeammatesSection(props: {
  teammates: readonly SidebarTeammate[]
  cells: number
}): React.ReactNode {
  if (props.teammates.length === 0) return null

  return (
    <Section label="Teammates" count={String(props.teammates.length)}>
      {props.teammates.map((teammate) => (
        <Row
          key={teammate.id}
          label={teammate.name}
          labelFg={theme.hover}
          cells={props.cells}
          mark={{ text: glyph.unseen, fg: teammate.activity === null ? theme.rule : theme.ok }}
          value={[{ text: teammate.activity ?? IDLE, fg: theme.hint }]}
        />
      ))}
    </Section>
  )
}
