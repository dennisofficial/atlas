import React from 'react'

import { type Hint } from '../hint-layout'
import { type PressHandlers, usePress } from '../hooks/use-press'
import type { StopGuardOption, StopGuardRow, StopGuardState } from '../stop-guard-model'
import { glyph, theme } from '../theme'
import { BottomDrawer, drawerCells, DrawerHints, DrawerLine, DRAWER_INSET } from './drawer'
import { clipSpans, spanCells, truncateCells } from './sidebar/cells'
import { Spans, type Span } from './spans'

const GUTTER_CELLS = 2

export const STOP_GUARD_INSET = DRAWER_INSET

export const stopGuardCells = (args: { width: number }): number => drawerCells(args)

const TAG_SEPARATOR = ' · '

const GUTTER = ' '.repeat(GUTTER_CELLS)

const NOTE_GAP = '   '

const HINTS: readonly Hint[] = [
  { key: 'Enter', label: 'to confirm' },
  { key: 'Esc', label: 'to cancel' },
]

function Line(props: {
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

const Gap = (): React.ReactNode => <box height={1} flexShrink={0} />

function Running(props: { running: readonly StopGuardRow[]; cells: number }): React.ReactNode {
  if (props.running.length === 0) return null

  return (
    <box flexDirection="column" flexShrink={0}>
      <Gap />
      {props.running.map((row) => (
        <Line
          key={row.id}
          spans={runningSpans({ row, cells: props.cells })}
          cells={props.cells}
        />
      ))}
    </box>
  )
}

function runningSpans(args: { row: StopGuardRow; cells: number }): Span[] {
  const tag: Span[] = [
    { text: args.row.tag, fg: theme.meta },
    { text: TAG_SEPARATOR, fg: theme.rule },
  ]

  return [
    ...tag,
    {
      text: truncateCells({
        text: args.row.label,
        cells: Math.max(0, args.cells - spanCells(tag)),
      }),
      fg: theme.body,
    },
  ]
}

function optionFg(args: { enabled: boolean; selected: boolean }): string {
  if (!args.enabled) return theme.hint
  if (args.selected) return theme.accent
  return theme.body
}

function optionSpans(args: {
  option: StopGuardOption<string>
  position: number
  selected: boolean
}): Span[] {
  const mark: Span = args.selected
    ? { text: `${glyph.selected} `, fg: theme.accent }
    : { text: GUTTER }

  return [
    mark,
    {
      text: `${String(args.position)}. ${args.option.label}`,
      fg: optionFg({ enabled: args.option.enabled, selected: args.selected }),
    },
    ...(args.option.note === undefined
      ? []
      : [{ text: `${NOTE_GAP}(${args.option.note})`, fg: theme.dim }]),
  ]
}

export function StopGuard(props: {
  width: number
  heading: string
  subtitle: string
  running: readonly StopGuardRow[]
  options: readonly StopGuardOption<string>[]
  state: StopGuardState
  overlay?: boolean
  onPick: (choice: string) => void
  onDismiss: () => void
}): React.ReactNode {
  const cells = stopGuardCells({ width: props.width })
  const press = usePress()

  return (
    <BottomDrawer overlay={props.overlay === true}>
      <Line spans={[{ text: props.heading, fg: theme.accent }]} cells={cells} />
      <Line spans={[{ text: props.subtitle, fg: theme.hint }]} cells={cells} />
      <Running running={props.running} cells={cells} />
      <Gap />
      {props.options.map((option, index) => (
        <Line
          key={option.choice}
          spans={optionSpans({
            option,
            position: index + 1,
            selected: index === props.state.selected,
          })}
          cells={cells}
          press={press(option.enabled ? () => props.onPick(option.choice) : undefined)}
        />
      ))}
      <Gap />
      <DrawerHints hints={HINTS} cells={cells} onDismiss={props.onDismiss} />
    </BottomDrawer>
  )
}
