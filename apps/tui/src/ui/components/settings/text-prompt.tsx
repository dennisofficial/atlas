import type { TextPrompt } from '@dltech/atlas-core'
import React from 'react'

import { fitHints, hintSpans, type Hint } from '../../hint-layout'
import { glyph, theme } from '../../theme'
import { clipSpans } from '../sidebar/cells'
import { Spans, type Span } from '../spans'
import { SettingsLine } from './rows'

const HINTS: readonly Hint[] = [
  { key: '⏎', label: 'save' },
  { key: 'esc', label: 'cancel' },
]

const EMPTY = 'type or paste it, then press enter — empty clears it'

const CARET = '▏'

export function TextSettingPrompt(props: { prompt: TextPrompt; cells: number }): React.ReactNode {
  const { prompt } = props

  const field: Span[] =
    prompt.typed.length === 0
      ? [{ text: EMPTY, fg: theme.hint }]
      : [
          { text: prompt.typed, fg: theme.bright },
          { text: CARET, fg: theme.accent },
        ]

  return (
    <box flexDirection="column" flexShrink={0}>
      <SettingsLine>
        <text fg={theme.meta}>{prompt.label.toUpperCase()}</text>
      </SettingsLine>
      <SettingsLine>
        <text>
          <Spans
            spans={clipSpans({
              spans: [{ text: `${glyph.marker} `, fg: theme.accent }, ...field],
              cells: props.cells,
            })}
          />
        </text>
      </SettingsLine>
      <SettingsLine>
        <text>
          <Spans
            spans={hintSpans({
              hints: fitHints({ hints: HINTS, cells: props.cells }),
              keyColour: theme.meta,
            })}
          />
        </text>
      </SettingsLine>
    </box>
  )
}
