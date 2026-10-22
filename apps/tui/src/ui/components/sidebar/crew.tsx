import React, { useState } from 'react'

import { pullRequestChip } from '../../../plugins/github/pull-request-pill'
import { foldCrew } from '../../../store/crew-fold'
import type { ECrewStanding } from '../../../store/crew-retirement'
import { crewTiersOf, type SidebarTeammate } from '../../../store/sidebar-model'
import {
  crewRowReading,
  isSubagentWorking,
  subagentContextLabel,
  subagentWentWrong,
  type SidebarSubagent,
} from '../../../store/subagent-row'
import { plural } from '../../../store/tools/reading'
import { contextUsageTone } from '../../context-bar'
import { useClickRegion } from '../../hooks/use-click-region'
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
 * Settled children fold behind one line per tier rather than leaving the panel: nothing a child
 * did disappears, it just stops spending rows. The warn marker is the one thing a folded row may
 * not hide — a failure the operator would otherwise have to expand to learn about.
 */
function CollapsedRow(props: {
  collapsed: number
  failed: boolean
  expanded: boolean
  onToggle: () => void
}): React.ReactNode {
  const region = useClickRegion(props.onToggle)

  return (
    <text wrapMode="none" flexShrink={0} {...region.handlers}>
      <span fg={theme.rule} {...region.wash}>
        {`${glyph.active} `}
      </span>
      <span fg={region.hovered ? theme.hover : theme.hint} {...region.wash}>
        {`${props.collapsed} settled ${props.expanded ? '▾' : '▸'}`}
      </span>
      {props.failed ? (
        <span fg={theme.warn} {...region.wash}>
          {' · one failed'}
        </span>
      ) : null}
    </text>
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

function CrewTier(props: {
  label: string
  rows: readonly SidebarSubagent[]
  standings: ReadonlyMap<string, ECrewStanding>
  cells: number
  onOpen?: ((agentId: string) => void) | undefined
}): React.ReactNode {
  const [expanded, setExpanded] = useState(false)
  if (props.rows.length === 0) return null

  const fold = foldCrew({
    rows: props.rows,
    standings: props.standings,
    expanded,
    keyOf: (row) => row.id,
    wentWrong: subagentWentWrong,
  })

  return (
    <Section
      label={props.label}
      count={`${props.rows.filter(isSubagentWorking).length}/${props.rows.length}`}
    >
      <CrewRows subagents={fold.shown} cells={props.cells} onOpen={props.onOpen} />
      {fold.collapsed.length === 0 ? null : (
        <CollapsedRow
          collapsed={fold.collapsed.length}
          failed={fold.collapsedFailed}
          expanded={expanded}
          onToggle={() => setExpanded((value) => !value)}
        />
      )}
    </Section>
  )
}

const NO_STANDINGS: ReadonlyMap<string, ECrewStanding> = new Map()

export function SubagentsSection(props: {
  subagents: readonly SidebarSubagent[]
  standings?: ReadonlyMap<string, ECrewStanding> | undefined
  cells: number
  onOpen?: (agentId: string) => void
}): React.ReactNode {
  if (props.subagents.length === 0) return null

  const { teammates, subagents } = crewTiersOf(props.subagents)
  const standings = props.standings ?? NO_STANDINGS

  return (
    <>
      <CrewTier
        label="Teammates"
        rows={teammates}
        standings={standings}
        cells={props.cells}
        onOpen={props.onOpen}
      />
      <CrewTier
        label="Sub-agents"
        rows={subagents}
        standings={standings}
        cells={props.cells}
        onOpen={props.onOpen}
      />
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
