import React from 'react'

import type { OnboardingRowView } from '../../composition/use-onboarding'
import { fitHints, hintSpans, type Hint } from '../hint-layout'
import { useClickRegion } from '../hooks/use-click-region'
import { theme } from '../theme'
import { clipSpans } from './sidebar/cells'
import { Spans, type Span } from './spans'

const HINTS: readonly Hint[] = [
  { key: '↑↓', label: 'row' },
  { key: '⏎', label: 'choose' },
  { key: 'esc', label: 'later' },
]

const INTRO =
  'Atlas makes every model a choice — the conversation, the quick background calls, compaction, sub-agents. Pick them once; change any of them later in settings › models.'

function Row(props: {
  row: OnboardingRowView
  cells: number
  selected: boolean
  onActivate: (row: OnboardingRowView) => void
}): React.ReactNode {
  const click = useClickRegion(() => props.onActivate(props.row))

  const marker: Span = props.row.done
    ? { text: ' ● ', fg: theme.ok }
    : { text: ' ○ ', fg: props.selected ? theme.accent : theme.meta }
  const label: Span = {
    text: props.row.label,
    fg: props.selected ? theme.bright : theme.meta,
  }
  const value: Span = {
    text: props.row.value,
    fg: props.row.done ? theme.bright : theme.meta,
  }
  const gap = Math.max(
    1,
    props.cells - 3 - [...props.row.label].length - [...props.row.value].length,
  )
  const band = props.selected ? theme.hoverBg : click.wash.bg

  return (
    <box flexShrink={0} {...(band === undefined ? {} : { backgroundColor: band })} {...click.handlers}>
      <text>
        <Spans
          spans={clipSpans({
            spans: [marker, label, { text: ' '.repeat(gap) }, value],
            cells: props.cells,
          })}
        />
      </text>
    </box>
  )
}

export function Onboarding(props: {
  width: number
  rows: readonly OnboardingRowView[]
  rowIndex: number
  onActivate: (row: OnboardingRowView) => void
  onDismiss: () => void
}): React.ReactNode {
  const cells = Math.min(72, Math.max(40, props.width - 12))
  const hints = hintSpans({ hints: fitHints({ hints: HINTS, cells }), keyColour: theme.meta })

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      zIndex={25}
      alignItems="center"
      justifyContent="center"
      backgroundColor={theme.appBg}
    >
      <box flexDirection="column" width={cells} flexShrink={0} gap={1}>
        <text>
          <span fg={theme.accent}>welcome to atlas</span>
        </text>
        <text fg={theme.meta}>{INTRO}</text>
        <box flexDirection="column" flexShrink={0}>
          {props.rows.map((row, index) => (
            <Row
              key={row.key}
              row={row}
              cells={cells}
              selected={index === props.rowIndex}
              onActivate={props.onActivate}
            />
          ))}
        </box>
        <text>
          <Spans spans={hints} />
        </text>
      </box>
    </box>
  )
}
