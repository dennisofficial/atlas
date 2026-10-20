import { EPublishStatus, type PlanRow } from '@dltech/atlas-harness'
import React from 'react'

import { Spans, type Span } from '../ui/components/spans'
import { useClickRegion } from '../ui/hooks/use-click-region'
import { glyph, theme } from '../ui/theme'
import { formatSize } from './push-text'

const SIZE_CELLS = 9
const TAG_CELLS = 9
const COLUMN_GAP = 2
const PREFIX_CELLS = 6
const MIN_LABEL_CELLS = 10

export const rowId = (id: string): string => `push-row-${id}`

const statusColour = (status: EPublishStatus): string => {
  if (status === EPublishStatus.New) return theme.ok
  if (status === EPublishStatus.Changed) return theme.warn
  return theme.dim
}

const fit = ({ text, cells }: { text: string; cells: number }): string => {
  const glyphs = [...text]
  if (glyphs.length <= cells) return text.padEnd(cells)
  return `${glyphs.slice(0, Math.max(0, cells - 1)).join('')}…`
}

export function rowSpans(args: {
  row: PlanRow
  selected: boolean
  current: boolean
  hovered: boolean
  cells: number
}): Span[] {
  const gap = ' '.repeat(COLUMN_GAP)
  const labelCells = Math.max(MIN_LABEL_CELLS, args.cells - PREFIX_CELLS - SIZE_CELLS - TAG_CELLS - COLUMN_GAP * 2)
  const emphasised = args.current || args.hovered

  return [
    { text: `${args.current ? glyph.selected : ' '} `, fg: theme.accent },
    { text: args.selected ? '[x] ' : '[ ] ', fg: args.selected ? theme.accent : theme.dim },
    { text: fit({ text: args.row.item.label, cells: labelCells }), fg: emphasised ? theme.bright : theme.body },
    { text: `${gap}${formatSize(args.row.item.bytes).padStart(SIZE_CELLS)}`, fg: theme.meta },
    { text: `${gap}${args.row.status}`, fg: statusColour(args.row.status) },
    { text: ' '.repeat(Math.max(0, TAG_CELLS - args.row.status.length)) },
  ]
}

export function PickerRow(props: {
  row: PlanRow
  selected: boolean
  current: boolean
  cells: number
  onPress: () => void
}): React.ReactNode {
  const region = useClickRegion(props.onPress)
  const bg = region.hovered ? region.wash.bg : props.current ? theme.selectedBg : undefined

  return (
    <text
      id={rowId(props.row.item.id)}
      wrapMode="none"
      width={props.cells}
      flexShrink={0}
      {...(bg === undefined ? {} : { bg })}
      {...region.handlers}
    >
      <Spans
        spans={rowSpans({
          row: props.row,
          selected: props.selected,
          current: props.current,
          hovered: region.hovered,
          cells: props.cells,
        })}
      />
    </text>
  )
}
