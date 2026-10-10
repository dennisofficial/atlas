import React from 'react'

import { pullRequestChip } from '../../../plugins/github/pull-request-pill'
import { crewTiersOf, type SidebarTeammate } from '../../../store/sidebar-model'
import {
  crewRowReading,
  isSubagentWorking,
  subagentContextLabel,
  type SidebarAgentFold,
  type SidebarCrewFold,
  type SidebarSubagent,
} from '../../../store/subagent-row'
import { plural } from '../../../store/tools/reading'
import { contextUsageTone } from '../../context-bar'
import { usePress } from '../../hooks/use-press'
import { MARK_OF, NAME_INK_OF, STATE_INK_OF } from '../../subagent-ink'
import { glyph, theme } from '../../theme'
import { Spans, type Span } from '../spans'
import { justifySpans, truncateCells } from './cells'
import { Row, Section } from './row'

const IDLE = 'idle'

/** A mark and the space after it, so the second line's model sits where the title sits. */
const TITLE_INDENT = '  '

const markFor = (subagent: SidebarSubagent) => MARK_OF[crewRowReading(subagent)]

const labelFor = (subagent: SidebarSubagent): string => {
  if (subagent.selected) return theme.court.external
  return NAME_INK_OF[crewRowReading(subagent)]
}

const chipFor = (args: { text: string; ground: string }): Span => ({
  text: ` ${args.text} `,
  fg: theme.appBg,
  bg: args.ground,
})

const ACTIVITY_COLORS: { shells: string; subagents: string } = {
  shells: theme.bright,
  subagents: theme.court.external,
}

function ActivityLine(props: { subagent: SidebarSubagent }): React.ReactNode {
  const activity = props.subagent.activity
  if (activity === undefined) return null

  const chips: Span[] = [{ text: TITLE_INDENT }]
  const addChip = (args: { text: string; ground: string }): void => {
    if (chips.length > 1) chips.push({ text: ' ' })
    chips.push(chipFor(args))
  }
  if (activity.shells > 0)
    addChip({ text: plural(activity.shells, 'shell'), ground: ACTIVITY_COLORS.shells })
  if (activity.subagents > 0)
    addChip({ text: plural(activity.subagents, 'agent'), ground: ACTIVITY_COLORS.subagents })

  return (
    <text>
      <Spans spans={chips} />
    </text>
  )
}

const valueFor = (subagent: SidebarSubagent) => [
  { text: subagent.state, fg: STATE_INK_OF[crewRowReading(subagent)] },
]

/**
 * The one line a settled child can spend beyond its title: why it failed, when it failed. A
 * bare "failed" in a panel this narrow answers nothing the operator is asking, and the reason
 * the loop recorded is the difference between respawning the child and fixing the cause. It is
 * one line and one line only — a provider error runs long, so it is folded to a single line and
 * clipped to the row's width rather than letting the reason take over the panel.
 */
function FailureLine(props: { subagent: SidebarSubagent; cells: number }): React.ReactNode {
  const reason = props.subagent.failureReason
  if (reason === null || reason === undefined) return null

  const oneLine = reason.replace(/\s+/g, ' ').trim()
  const text = truncateCells({ text: `${TITLE_INDENT}${oneLine}`, cells: props.cells })

  return (
    <text>
      <Spans spans={[{ text, fg: theme.warn }]} />
    </text>
  )
}

/**
 * A second line, and only when there is a reading to put on it — the same pair the footer gives
 * the main agent, with the child's own math: the model it runs, lined up under the title, and
 * what its own window holds on the right edge. Worth the row's height in every state — running,
 * blocked and settled alike — but an empty one would spend the height on nothing, which in a
 * panel this narrow is what makes a crew unreadable.
 */
const pullRequestSpanOf = (subagent: SidebarSubagent): Span | null => {
  if (subagent.pullRequest === undefined) return null

  const chip = pullRequestChip(subagent.pullRequest)
  return chipFor({ text: subagent.pullRequest.label, ground: chip.ground })
}

function FiguresLine(props: { subagent: SidebarSubagent; cells: number }): React.ReactNode {
  const context = subagentContextLabel(props.subagent.context)
  const pill = pullRequestSpanOf(props.subagent)
  if (props.subagent.model === null && context === null && pill === null) return null

  const model: readonly Span[] =
    props.subagent.model === null
      ? []
      : [{ text: `${TITLE_INDENT}${props.subagent.model}`, fg: theme.dim }]
  const usage: readonly Span[] =
    context === null || props.subagent.context === undefined
      ? []
      : [{ text: context, fg: contextUsageTone(props.subagent.context.tokens) }]
  const reading: readonly Span[] =
    pill === null ? usage : usage.length === 0 ? [pill] : [pill, { text: ' ' }, ...usage]

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
      mark={{ text: glyph.active, fg: theme.rule }}
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
          <FailureLine subagent={subagent} cells={props.cells} />
          <ActivityLine subagent={subagent} />
        </box>
      ))}
    </>
  )
}

export function SubagentsSection(props: {
  subagents: readonly SidebarSubagent[]
  cells: number
  fold?: SidebarAgentFold | undefined
  onOpen?: (agentId: string) => void
}): React.ReactNode {
  if (props.subagents.length === 0) return null

  const { teammates, subagents } = crewTiersOf(props.subagents)
  const hiddenTeammates = props.fold?.hiddenTeammates ?? 0
  const hiddenSubagents = (props.fold?.hidden ?? 0) - hiddenTeammates

  return (
    <>
      {teammates.length === 0 ? null : (
        <Section
          label="Teammates"
          count={`${teammates.filter(isSubagentWorking).length}/${teammates.length + hiddenTeammates}`}
        >
          <CrewRows subagents={teammates} cells={props.cells} onOpen={props.onOpen} />
        </Section>
      )}
      {subagents.length === 0 ? null : (
        <Section
          label="Sub-agents"
          count={`${subagents.filter(isSubagentWorking).length}/${subagents.length + hiddenSubagents}`}
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
