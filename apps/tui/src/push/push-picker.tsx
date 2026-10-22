import type { PlanRow } from '@dltech/atlas-harness'
import type { ScrollBoxRenderable } from '@opentui/core'
import { useKeyboard, useTerminalDimensions } from '@opentui/react'
import React, { useEffect, useRef, useState } from 'react'

import { Spans, type Span } from '../ui/components/spans'
import { fitHints, hintSpans, type Hint } from '../ui/hint-layout'
import { useHiddenVerticalScrollbar } from '../ui/hide-scrollbar'
import { theme } from '../ui/theme'
import {
  carriedOver,
  EPickerLine,
  EPickerOutcome,
  listOf,
  moveCursor,
  pickerLines,
  selectionOf,
  startState,
  toggleAllShown,
  toggleSelected,
  toggleShowAll,
  type PickerOutcome,
  type PickerState,
} from './push-picker-model'
import { PickerRow, rowId } from './push-row'
import { formatSize } from './push-text'

const PAD = 2

const hintsFor = (showAll: boolean): readonly Hint[] => [
  { key: '↑↓', label: 'move' },
  { key: 'space', label: 'toggle' },
  { key: 'A', label: 'all on/off' },
  { key: 'a', label: showAll ? 'changed only' : 'show all' },
  { key: 'enter', label: 'publish' },
  { key: 'esc', label: 'cancel' },
]

function Header(props: { title: string; selected: number; total: number }): React.ReactNode {
  return (
    <text wrapMode="none" flexShrink={0} marginTop={1}>
      <span fg={theme.bright}>{props.title}</span>
      <span fg={theme.meta}>{`  ${props.selected} of ${props.total}`}</span>
    </text>
  )
}

export function PushPicker(props: {
  rows: readonly PlanRow[]
  showAll?: boolean | undefined
  onDone: (outcome: PickerOutcome) => void
}): React.ReactNode {
  const { rows } = props
  const { width } = useTerminalDimensions()
  const cells = Math.max(0, width - PAD * 2)
  const [state, setState] = useState<PickerState>(() =>
    startState({ rows, showAll: props.showAll === true }),
  )
  const scroller = useRef<ScrollBoxRenderable | null>(null)
  const attachScroller = useHiddenVerticalScrollbar(scroller)
  const finished = useRef(false)

  const list = listOf({ rows, showAll: state.showAll })
  const lines = pickerLines({ list, selected: state.selected })
  const carried = carriedOver(rows)
  const total = selectionOf({ rows, selected: state.selected })

  const finish = (outcome: PickerOutcome): void => {
    if (finished.current) return
    finished.current = true
    props.onDone(outcome)
  }

  const handlePress = (id: string): void =>
    setState((current) => ({ ...toggleSelected({ state: current, id }), cursorId: id }))

  useKeyboard((key) => {
    if (key.ctrl) {
      if (key.name === 'c') finish({ kind: EPickerOutcome.Cancelled })
      return
    }
    if (key.name === 'up' || key.name === 'k')
      setState((current) => moveCursor({ state: current, rows, delta: -1 }))
    else if (key.name === 'down' || key.name === 'j')
      setState((current) => moveCursor({ state: current, rows, delta: 1 }))
    else if (key.name === 'space' && state.cursorId !== null) handlePress(state.cursorId)
    else if (key.name === 'a' && key.shift)
      setState((current) => toggleAllShown({ state: current, rows }))
    else if (key.name === 'a') setState((current) => toggleShowAll({ state: current, rows }))
    else if (key.name === 'return' || key.name === 'enter')
      finish({ kind: EPickerOutcome.Chosen, ids: total.ids })
    else if (key.name === 'escape' || key.name === 'q') finish({ kind: EPickerOutcome.Cancelled })
  })

  const firstId = list[0]?.item.id
  useEffect(() => {
    if (state.cursorId === null) return
    if (state.cursorId === firstId) scroller.current?.scrollTo(0)
    else scroller.current?.scrollChildIntoView(rowId(state.cursorId))
  }, [state.cursorId, state.showAll, firstId])

  const carriedLine = state.showAll
    ? `showing all ${rows.length} items`
    : carried === 0
      ? 'every item is new or changed'
      : `${carried} unchanged carried over`
  const totalSpans: Span[] = [
    { text: `${total.ids.length} selected`, fg: theme.bright },
    { text: ` · ${formatSize(total.bytes)}`, fg: theme.meta },
  ]

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={theme.appBg}
      paddingLeft={PAD}
      paddingRight={PAD}
      paddingTop={1}
    >
      <text wrapMode="none" flexShrink={0}>
        <span fg={theme.accent}>atlas push</span>
        <span fg={theme.meta}>
          {'  publish skills, instructions and MCP config to Atlas Cloud'}
        </span>
      </text>
      <text wrapMode="none" flexShrink={0} fg={theme.hint}>
        {carriedLine}
      </text>
      <scrollbox ref={attachScroller} flexGrow={1} flexShrink={1} flexBasis={0}>
        <box flexDirection="column" flexShrink={0}>
          {lines.map((line) =>
            line.kind === EPickerLine.Header ? (
              <Header
                key={line.title}
                title={line.title}
                selected={line.selected}
                total={line.total}
              />
            ) : (
              <PickerRow
                key={line.row.item.id}
                row={line.row}
                selected={state.selected.has(line.row.item.id)}
                current={line.row.item.id === state.cursorId}
                cells={cells}
                onPress={() => handlePress(line.row.item.id)}
              />
            ),
          )}
        </box>
      </scrollbox>
      <text wrapMode="none" flexShrink={0} marginTop={1}>
        <Spans spans={totalSpans} />
      </text>
      <text wrapMode="none" flexShrink={0}>
        <Spans
          spans={hintSpans({
            hints: fitHints({ hints: hintsFor(state.showAll), cells }),
            keyColour: theme.meta,
          })}
        />
      </text>
    </box>
  )
}
