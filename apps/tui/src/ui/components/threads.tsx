import type { KeyBinding, ScrollBoxRenderable } from '@opentui/core'
import React, { useEffect, useRef } from 'react'

import { EExecutionLocation } from '@dltech/atlas-core'

import { type Hint } from '../hint-layout'
import { type PressHandlers, usePress } from '../hooks/use-press'
import { useRelaxedThumb } from '../scrollbar-thumb'
import { cloudSandboxBadge } from '../thread-badges'
import { glyph, theme } from '../theme'
import {
  matchingThreads,
  selectedThread,
  threadAge,
  visibleChips,
  type ThreadRow,
  type ThreadsState,
} from '../threads-model'
import {
  BottomDrawer,
  drawerCells,
  DrawerGap,
  DrawerHeading,
  DrawerHints,
  DrawerLine,
  DRAWER_INSET,
} from './drawer'
import { clipSpans, spanCells } from './sidebar/cells'
import { Spans, type Span } from './spans'

export const THREADS_INSET = DRAWER_INSET

export const threadsCells = (args: { width: number }): number => drawerCells(args)

export const THREADS_HEADING = 'Conversations'

export const NO_THREADS = 'No other conversations here yet.'

export const NO_MATCHES = 'Nothing matches that.'

/** Rows the list shows at once; taller listings scroll inside the box. */
export const THREAD_LIST_ROWS = 16

export const CURRENT_LABEL = '(current)'

export const MAIN_LABEL = `${glyph.home} main`

const FILTER_PLACEHOLDER = 'type to filter'

/**
 * macOS's rub-out-the-line. ⌘ reaches a terminal only under the kitty keyboard protocol, which
 * reports it as `super`; OpenTUI's default keymap binds nothing to it, so a single-line field
 * answers it against the whole value.
 */
const FILTER_BINDINGS: KeyBinding[] = [{ name: 'backspace', super: true, action: 'delete-to-line-start' }]

const GUTTER = ' '.repeat(2)

const HINTS: readonly Hint[] = [
  { key: '↑↓', label: 'pick' },
  { key: '⏎', label: 'open' },
  { key: 'type', label: 'filter' },
  { key: 'esc', label: 'close' },
]

function TextLine(props: {
  spans: readonly Span[]
  cells: number
  press?: PressHandlers
}): React.ReactNode {
  return (
    <DrawerLine {...(props.press === undefined ? {} : { press: props.press })}>
      <text>
        <Spans spans={clipSpans({ spans: props.spans, cells: props.cells })} />
      </text>
    </DrawerLine>
  )
}

function FilterLine(props: {
  query: string
  onQueryChange: (value: string) => void
}): React.ReactNode {
  return (
    <DrawerLine>
      <box flexDirection="row" flexGrow={1}>
        <text fg={theme.accent}>{`${glyph.marker} `}</text>
        <input
          flexGrow={1}
          value={props.query}
          focused
          placeholder={FILTER_PLACEHOLDER}
          textColor={theme.bright}
          placeholderColor={theme.hint}
          cursorColor={theme.caretBg}
          keyBindings={FILTER_BINDINGS}
          onInput={props.onQueryChange}
        />
      </box>
    </DrawerLine>
  )
}

function ThreadLine(props: {
  row: ThreadRow
  cells: number
  selected: boolean
  now: number
  press: PressHandlers
}): React.ReactNode {
  const band = props.selected ? theme.hoverBg : undefined
  const age = threadAge({ updatedAt: props.row.updatedAt, now: props.now })
  const trailing = props.row.active ? CURRENT_LABEL : age

  const mark: Span = {
    text: `${props.row.active ? glyph.active : glyph.available} `,
    fg: props.row.active ? theme.accent : theme.hint,
  }

  const label: Span = {
    text: props.row.label,
    fg: props.selected ? theme.bright : props.row.titled ? theme.hover : theme.hint,
  }

  const right: Span = { text: trailing, fg: theme.hint }
  const gap = Math.max(1, props.cells - spanCells([mark, label, right]))

  const badge =
    props.row.location === EExecutionLocation.Cloud
      ? cloudSandboxBadge({ state: props.row.sandbox })
      : null

  const place: Span =
    badge !== null
      ? badge
      : {
          text:
            props.row.worktree === undefined
              ? MAIN_LABEL
              : `${glyph.worktree} ${props.row.worktree.branch}`,
          fg: theme.hint,
        }

  const chips = props.row.chips ?? []
  const placeSpans: Span[] = [{ text: GUTTER }, place]
  const budget = Math.max(0, props.cells - spanCells(placeSpans) - (chips.length === 0 ? 0 : 2))
  const visible = visibleChips({ chips, cells: budget })

  const chipSpans: Span[] = visible.shown.flatMap((chip, index) => [
    { text: '  ' },
    { text: ` ${chip.label} `, fg: chip.ink, bg: chip.ground } as Span,
    ...(index === visible.shown.length - 1 && visible.overflow > 0
      ? [{ text: '  ' }, { text: `+${visible.overflow}`, fg: theme.hint } as Span]
      : []),
  ])
  if (visible.shown.length === 0 && visible.overflow > 0) {
    chipSpans.push({ text: '  ' }, { text: `+${visible.overflow}`, fg: theme.hint })
  }

  return (
    <box flexDirection="column" flexShrink={0}>
      <DrawerLine
        press={props.press}
        {...(band === undefined ? {} : { band })}
      >
        <text>
          <Spans
            spans={clipSpans({
              spans: [mark, label, { text: ' '.repeat(gap) }, right],
              cells: props.cells,
            })}
          />
        </text>
      </DrawerLine>
      <DrawerLine
        press={props.press}
        {...(band === undefined ? {} : { band })}
      >
        <text>
          <Spans
            spans={clipSpans({
              spans: [...placeSpans, ...chipSpans],
              cells: props.cells,
            })}
          />
        </text>
      </DrawerLine>
    </box>
  )
}

export function Threads(props: {
  width: number
  state: ThreadsState
  overlay?: boolean
  onPick: (row: ThreadRow) => void
  onDismiss: () => void
  onQueryChange: (query: string) => void
}): React.ReactNode {
  const cells = threadsCells({ width: props.width })
  const press = usePress()
  const scroller = useRef<ScrollBoxRenderable | null>(null)
  const relax = useRelaxedThumb()
  const { state } = props
  const matches = matchingThreads(state)
  const selected = selectedThread(state)
  const empty = state.rows.length === 0
  const filteredOut = !empty && matches.length === 0

  useEffect(() => {
    const box = scroller.current
    if (box === null || selected === undefined) return
    box.scrollChildIntoView(selected.threadId)
  }, [selected])

  return (
    <BottomDrawer
      overlay={props.overlay === true}
      footer={<DrawerHints hints={HINTS} cells={cells} onDismiss={props.onDismiss} />}
    >
      <box flexDirection="column" flexShrink={0}>
        <DrawerHeading label={THREADS_HEADING} />
        <FilterLine query={state.query} onQueryChange={props.onQueryChange} />
        <DrawerGap />
      </box>
      <scrollbox
        ref={(box: ScrollBoxRenderable | null) => {
          scroller.current = box
          relax(box)
        }}
        height={THREAD_LIST_ROWS}
        flexShrink={0}
        focusable={false}
      >
        {state.loading ? (
          <TextLine spans={[{ text: 'listing…', fg: theme.hint }]} cells={cells} />
        ) : null}
        {matches.map((row) => (
          <ThreadLine
            key={row.threadId}
            row={row}
            cells={cells}
            now={state.openedAt}
            selected={selected?.threadId === row.threadId}
            press={press(() => props.onPick(row))}
          />
        ))}
        {!state.loading && empty ? (
          <TextLine spans={[{ text: NO_THREADS, fg: theme.hint }]} cells={cells} />
        ) : null}
        {filteredOut ? (
          <TextLine spans={[{ text: NO_MATCHES, fg: theme.hint }]} cells={cells} />
        ) : null}
      </scrollbox>
      <DrawerGap />
      {state.failure === null ? null : (
        <TextLine spans={[{ text: state.failure, fg: theme.warn }]} cells={cells} />
      )}
    </BottomDrawer>
  )
}
