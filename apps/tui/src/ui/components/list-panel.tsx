import type { KeyEvent } from '@opentui/core'
import React from 'react'

import { fitHints, hintSpans, type Hint } from '../hint-layout'
import { useClickRegion } from '../hooks/use-click-region'
import { menuWindow } from '../menu-model'
import { theme } from '../theme'
import { Panel } from './panel'
import { clipSpans } from './sidebar/cells'
import { Spans, type Span } from './spans'

export type ListPanelRow = {
  key: string
  label: string
  detail?: string | undefined
  mark?: { text: string; tone: 'ok' | 'warn' | 'meta' } | undefined
}

const TONE: Readonly<Record<'ok' | 'warn' | 'meta', string>> = {
  ok: theme.ok,
  warn: theme.warn,
  meta: theme.meta,
}

const HINTS: readonly Hint[] = [
  { key: '↑↓', label: 'pick' },
  { key: '⏎', label: 'open' },
  { key: 'esc', label: 'close' },
]

const WINDOW_ROWS = 12

function Row(props: {
  row: ListPanelRow
  cells: number
  selected: boolean
  onPick: () => void
}): React.ReactNode {
  const click = useClickRegion(props.onPick)
  const mark: Span =
    props.row.mark === undefined
      ? { text: '  ', fg: theme.meta }
      : { text: `${props.row.mark.text} `, fg: TONE[props.row.mark.tone] }
  const label: Span = {
    text: props.row.label,
    fg: props.selected ? theme.bright : theme.meta,
  }
  const gap = Math.max(1, props.cells - 2 - [...props.row.label].length)
  const detail: Span = {
    text: props.row.detail === undefined ? '' : truncate(props.row.detail, Math.max(0, gap - 2)),
    fg: theme.hint,
  }
  const band = props.selected ? theme.hoverBg : click.wash.bg

  return (
    <box
      flexShrink={0}
      {...(band === undefined ? {} : { backgroundColor: band })}
      {...click.handlers}
    >
      <text>
        <Spans
          spans={clipSpans({
            spans: [mark, label, { text: gap > 1 ? '  ' : ' ' }, detail],
            cells: props.cells,
          })}
        />
      </text>
    </box>
  )
}

const truncate = (text: string, cells: number): string =>
  cells <= 0
    ? ''
    : [...text].length <= cells
      ? text
      : `${[...text].slice(0, Math.max(0, cells - 1)).join('')}…`

export function ListPanel(props: {
  title: string
  rows: readonly ListPanelRow[]
  index: number
  width: number
  empty: string
  hints?: readonly Hint[] | undefined
  onPick: (index: number) => void
}): React.ReactNode {
  const cells = Math.min(84, Math.max(40, props.width - 12))
  const window = menuWindow({ entries: props.rows, index: props.index, rows: WINDOW_ROWS })
  const start = window.start

  return (
    <box
      position="absolute"
      top={2}
      left={0}
      right={0}
      bottom={2}
      zIndex={30}
      alignItems="center"
      justifyContent="center"
    >
      <Panel
        width={cells}
        fill={theme.panelBg}
        band={theme.panelBand}
        label={<text fg={theme.accent}> {props.title} </text>}
        badge={<text fg={theme.meta}>{`${props.rows.length}   ⏎ open`}</text>}
        footer={
          <text>
            <Spans
              spans={hintSpans({
                hints: fitHints({ hints: props.hints ?? HINTS, cells: cells - 4 }),
                keyColour: theme.meta,
              })}
            />
          </text>
        }
      >
        {props.rows.length === 0 ? (
          <box height={1} flexShrink={0}>
            <text fg={theme.meta}>{props.empty}</text>
          </box>
        ) : null}
        {window.visible.map((row, offset) => (
          <Row
            key={row.key}
            row={row}
            cells={cells - 4}
            selected={start + offset === props.index}
            onPick={() => props.onPick(start + offset)}
          />
        ))}
      </Panel>
    </box>
  )
}

export const panelMovedIndex = (args: {
  index: number
  count: number
  key: KeyEvent
}): number | null => {
  if (args.key.name !== 'up' && args.key.name !== 'down') return null
  if (args.count === 0) return args.index
  const next = args.index + (args.key.name === 'up' ? -1 : 1)
  return Math.min(Math.max(next, 0), args.count - 1)
}
