import type { SettingPage } from '@dltech/atlas-core'
import React from 'react'

import { cellsOf } from '../../hint-layout'
import { glyph, theme } from '../../theme'
import { clipSpans, spanCells, truncateCells } from '../sidebar/cells'
import { Spans, type Span } from '../spans'
import { SETTINGS_PAD } from './rows'

const TITLE = 'settings'

const TAB_GAP = '  '

const DIVIDER = ' │ '

const GAP_CELLS = 1

const tabSpans = (args: {
  pages: readonly SettingPage[]
  pageIndex: number
}): Span[] =>
  args.pages.flatMap((page, index) => [
    ...(index === 0 ? [] : [{ text: TAB_GAP }]),
    { text: page.label, fg: index === args.pageIndex ? theme.accent : theme.hint },
  ])

const ELISION_CELLS = 1 + TAB_GAP.length

const windowedTabSpans = (args: {
  pages: readonly SettingPage[]
  pageIndex: number
  cells: number
}): Span[] => {
  const spans = tabSpans(args)
  if (spanCells(spans) <= args.cells) return spans

  const activeIndex = args.pageIndex * 2
  const active = spans[activeIndex]
  if (active === undefined) return spans

  let start = 0
  while (start < activeIndex) {
    if (spans[start + 2] === undefined) break
    if (spanCells(spans.slice(start)) + ELISION_CELLS <= args.cells) break
    start += 2
  }

  if (start === 0) return clipSpans({ spans, cells: args.cells })

  const room = args.cells - ELISION_CELLS
  if (room < cellsOf(active.text)) return clipSpans({ spans: [active], cells: args.cells })

  const elision: Span[] = [{ text: '…', fg: theme.hint }, { text: TAB_GAP }]
  return clipSpans({ spans: [...elision, ...spans.slice(start)], cells: args.cells })
}

export function SettingsHead(props: {
  cells: number
  pages: readonly SettingPage[]
  pageIndex: number
  origin: string
}): React.ReactNode {
  const prefix: Span[] = [
    { text: `${glyph.block} `, fg: theme.accent },
    { text: TITLE, fg: theme.hover },
    { text: DIVIDER, fg: theme.rule },
  ]
  const left: Span[] = [
    ...prefix,
    ...windowedTabSpans({
      pages: props.pages,
      pageIndex: props.pageIndex,
      cells: Math.max(0, props.cells - spanCells(prefix)),
    }),
  ]

  const room = props.cells - spanCells(left) - GAP_CELLS
  const origin = room <= 0 ? '' : truncateCells({ text: props.origin, cells: room })
  const gap = Math.max(GAP_CELLS, props.cells - spanCells(left) - cellsOf(origin))

  return (
    <box
      height={1}
      flexShrink={0}
      paddingLeft={SETTINGS_PAD}
      paddingRight={SETTINGS_PAD}
      backgroundColor={theme.panelBg}
    >
      <text>
        <Spans
          spans={clipSpans({
            spans: [...left, { text: ' '.repeat(gap) }, { text: origin, fg: theme.hint }],
            cells: props.cells,
          })}
        />
      </text>
    </box>
  )
}
