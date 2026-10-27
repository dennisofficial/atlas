import { EAgentStatus } from '@dltech/atlas-core'
import React from 'react'

import { pullRequestStatusColor } from '../../../plugins/github/pull-request-pill'
import { EFoldPart, foldCrew, foldParts } from '../../../store/crew-fold'
import { isAgentLive, type SidebarSubagent } from '../../../store/subagent-row'
import { useClickRegion } from '../../hooks/use-click-region'
import { glyph, theme } from '../../theme'
import type { Span } from '../spans'
import { Spans } from '../spans'
import { justifySpans, SIDE_GAP_CELLS, spanCells, truncateCells } from './cells'
import { Section } from './row'

const FOLD_SEPARATOR = ' · '

const isHeld = (subagent: SidebarSubagent): boolean =>
  subagent.status === EAgentStatus.Running && subagent.waitingOn !== undefined

const MARK_OF: Record<EAgentStatus, Span> = {
  [EAgentStatus.Running]: { text: glyph.live, fg: theme.ok },
  [EAgentStatus.Blocked]: { text: glyph.attention, fg: theme.warn },
  [EAgentStatus.Paused]: { text: glyph.attention, fg: theme.warn },
  [EAgentStatus.Finished]: { text: glyph.passed, fg: theme.meta },
  [EAgentStatus.Failed]: { text: glyph.failed, fg: theme.error },
  [EAgentStatus.Stopped]: { text: glyph.failed, fg: theme.error },
}

const HELD_MARK: Span = { text: glyph.held, fg: theme.meta }

const markOf = (subagent: SidebarSubagent): Span =>
  isHeld(subagent) ? HELD_MARK : MARK_OF[subagent.status]

const VALUE_INK: Record<EAgentStatus, string> = {
  [EAgentStatus.Running]: theme.hint,
  [EAgentStatus.Blocked]: theme.warn,
  [EAgentStatus.Paused]: theme.warn,
  [EAgentStatus.Finished]: theme.meta,
  [EAgentStatus.Failed]: theme.error,
  [EAgentStatus.Stopped]: theme.error,
}

const grounded = (args: { spans: readonly Span[]; bg: string | undefined }): Span[] => {
  const { bg } = args
  return bg === undefined ? [...args.spans] : args.spans.map((span) => ({ ...span, bg }))
}

function rowSpans(args: { subagent: SidebarSubagent; cells: number }): Span[] {
  const { subagent } = args
  const pill: Span[] =
    subagent.pullRequest === undefined
      ? []
      : [
          { text: subagent.pullRequest.label, fg: pullRequestStatusColor(subagent.pullRequest) },
          { text: ' ' },
        ]
  const mark: Span[] = [markOf(subagent), { text: ' ' }]
  const value: Span[] = [{ text: subagent.value, fg: VALUE_INK[subagent.status] }]

  const room = args.cells - spanCells(pill) - spanCells(mark) - spanCells(value) - SIDE_GAP_CELLS
  const title: Span = {
    text: truncateCells({ text: subagent.name, cells: Math.max(1, room) }),
    fg: subagent.selected ? theme.court.external : theme.hover,
  }

  return justifySpans({ left: [...pill, ...mark, title], right: value, cells: args.cells })
}

function AgentRow(props: {
  subagent: SidebarSubagent
  cells: number
  onOpen?: ((agentId: string) => void) | undefined
}): React.ReactNode {
  const { subagent, onOpen } = props
  const region = useClickRegion(onOpen === undefined ? undefined : () => onOpen(subagent.id))
  const bg = region.hovered ? theme.hoverBg : subagent.selected ? theme.userBg : undefined

  return (
    <text wrapMode="none" flexShrink={0} {...region.handlers}>
      <Spans spans={grounded({ spans: rowSpans({ subagent, cells: props.cells }), bg })} />
    </text>
  )
}

const FOLD_MARK: Record<EFoldPart, Span> = {
  [EFoldPart.Done]: { text: glyph.passed, fg: theme.meta },
  [EFoldPart.Failed]: { text: glyph.failed, fg: theme.error },
  [EFoldPart.Stopped]: { text: glyph.failed, fg: theme.error },
}

function foldSpans(args: { parts: ReturnType<typeof foldParts>; expanded: boolean }): Span[] {
  const spans: Span[] = []
  args.parts.forEach((entry, at) => {
    if (at > 0) spans.push({ text: FOLD_SEPARATOR, fg: theme.hint })
    spans.push({ ...FOLD_MARK[entry.part] }, { text: ` ${entry.label}`, fg: theme.meta })
  })
  spans.push({ text: `  ${args.expanded ? glyph.expanded : glyph.collapsed}`, fg: theme.hint })
  return spans
}

function FoldRow(props: {
  parts: ReturnType<typeof foldParts>
  expanded: boolean
  onToggle: () => void
}): React.ReactNode {
  const region = useClickRegion(props.onToggle)
  const bg = region.hovered ? theme.hoverBg : undefined

  return (
    <text wrapMode="none" flexShrink={0} {...region.handlers}>
      <Spans
        spans={grounded({
          spans: foldSpans({ parts: props.parts, expanded: props.expanded }),
          bg,
        })}
      />
    </text>
  )
}

export function AgentsSection(props: {
  subagents: readonly SidebarSubagent[]
  expanded: boolean
  cells: number
  onOpen?: ((agentId: string) => void) | undefined
  onToggle?: (() => void) | undefined
}): React.ReactNode {
  if (props.subagents.length === 0) return null

  const viewing = props.subagents.find((subagent) => subagent.selected)?.id ?? null
  const fold = foldCrew({
    rows: props.subagents,
    expanded: props.expanded,
    viewing,
    idOf: (subagent) => subagent.id,
  })
  const running = props.subagents.filter(isAgentLive).length
  const rowFor = (subagent: SidebarSubagent): React.ReactNode => (
    <AgentRow key={subagent.id} subagent={subagent} cells={props.cells} onOpen={props.onOpen} />
  )

  return (
    <Section
      label="Agents"
      cells={props.cells}
      {...(running === 0 ? {} : { count: `${running} running` })}
    >
      {fold.teammates.map(rowFor)}
      {fold.subagents.map(rowFor)}
      {fold.folded.length === 0 ? null : (
        <FoldRow
          parts={foldParts(fold)}
          expanded={props.expanded}
          onToggle={props.onToggle ?? (() => undefined)}
        />
      )}
      {props.expanded ? fold.folded.map(rowFor) : null}
    </Section>
  )
}
