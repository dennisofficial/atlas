import type { CommandEntry } from '@dltech/atlas-commands'
import { ECommandEntryKind } from '@dltech/atlas-commands'
import React from 'react'

import { cellsOf } from '../ui/hint-layout'
import { PANEL_INSET, PANEL_PAD, Panel } from '../ui/components/panel'
import { clipSpans, truncateCells } from '../ui/components/sidebar/cells'
import { Spans, type Span } from '../ui/components/spans'
import { glyph, theme } from '../ui/theme'
import { SLASH_MENU_ROWS, slashMenuWindow, type SlashMenuState } from './slash-menu'

const CHROME_COLUMNS = PANEL_INSET + PANEL_PAD

const CARET_CELLS = 2

const GAP_CELLS = 2

const LABEL_SUMMARY_FLOOR = 32

const MARK: Readonly<Record<ECommandEntryKind, string>> = {
  [ECommandEntryKind.Command]: 'cmd',
  [ECommandEntryKind.Skill]: 'skill',
}

const MARK_CELLS = cellsOf(MARK[ECommandEntryKind.Skill])

const labelOf = (entry: CommandEntry): string =>
  entry.argumentHint === undefined ? `/${entry.name}` : `/${entry.name} ${entry.argumentHint}`

const labelColumn = (entries: readonly CommandEntry[], cells: number): number => {
  const widest =
    entries.reduce((acc, entry) => Math.max(acc, cellsOf(labelOf(entry))), 0) + GAP_CELLS
  const budget = (labelCells: number): number =>
    cells - CARET_CELLS - labelCells - GAP_CELLS - MARK_CELLS
  if (budget(widest) >= LABEL_SUMMARY_FLOOR) return widest
  return Math.max(GAP_CELLS, widest - (LABEL_SUMMARY_FLOOR - budget(widest)))
}

const rowSpans = (args: {
  entry: CommandEntry
  cells: number
  labelCells: number
  selected: boolean
}): Span[] => {
  const band = args.selected ? { bg: theme.hoverBg } : {}
  const label = truncateCells({
    text: labelOf(args.entry),
    cells: Math.max(0, args.labelCells - GAP_CELLS),
  })
  const padded = `${label}${' '.repeat(Math.max(0, args.labelCells - cellsOf(label)))}`
  const mark = MARK[args.entry.kind]
  const spent = CARET_CELLS + cellsOf(padded) + cellsOf(mark)
  const summary = truncateCells({
    text: args.entry.summary,
    cells: Math.max(0, args.cells - spent - GAP_CELLS),
  })
  const fill = ' '.repeat(Math.max(0, args.cells - spent - cellsOf(summary)))

  return clipSpans({
    spans: [
      { text: args.selected ? `${glyph.selected} ` : '  ', fg: theme.accent, ...band },
      { text: padded, fg: args.selected ? theme.bright : theme.hover, ...band },
      { text: summary, fg: theme.hint, ...band },
      { text: fill, ...band },
      {
        text: mark,
        fg: args.entry.kind === ECommandEntryKind.Skill ? theme.court.external : theme.meta,
        ...band,
      },
    ],
    cells: args.cells,
  })
}

function SlashRow(props: {
  entry: CommandEntry
  cells: number
  labelCells: number
  selected: boolean
}): React.ReactNode {
  return (
    <box height={1} flexShrink={0}>
      <text>
        <Spans
          spans={rowSpans({
            entry: props.entry,
            cells: props.cells,
            labelCells: props.labelCells,
            selected: props.selected,
          })}
        />
      </text>
    </box>
  )
}

export function SlashMenu(props: {
  width: number
  state: SlashMenuState
  onSelect: (index: number) => void
}): React.ReactNode {
  const cells = Math.max(0, props.width - CHROME_COLUMNS)
  const { start, visible } = slashMenuWindow({ state: props.state, rows: SLASH_MENU_ROWS })
  const labelCells = labelColumn(visible, cells)
  const counted = `${props.state.index + 1}/${props.state.rows.length}`

  return (
    <Panel
      width={props.width}
      fill={theme.overlayBg}
      label={
        <text fg={theme.meta} bg={theme.overlayBg}>
          {' Commands '}
        </text>
      }
      badge={<text fg={theme.hint} bg={theme.overlayBg}>{` ${counted} · ⇥ complete `}</text>}
    >
      <box flexDirection="column" flexShrink={0}>
        {visible.map((entry, offset) => (
          <SlashRow
            key={entry.name}
            entry={entry}
            cells={cells}
            labelCells={labelCells}
            selected={start + offset === props.state.index}
          />
        ))}
      </box>
    </Panel>
  )
}
