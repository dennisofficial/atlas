import React from 'react'

import { ERunRemedy } from '@dltech/atlas-core'
import type { RunAttentionRemedy } from '@dltech/atlas-client/transcript'

import { useClickRegion } from '../../hooks/use-click-region'
import { EKeyGroup, EKeyLayer, spellChord, useKeyBindings, type KeyDeclaration } from '../../keys'
import { formatElapsed, formatTokens, glyph, theme, TRANSCRIPT_INSET } from '../../theme'
import { CloseButton } from '../close-button'
import { Panel } from '../panel'
import { Spans } from '../spans'
import type { Span } from '../spans'

const HEADING = 'failed'

export const SETTINGS_HINT = 'fix the key: ctrl+a or /auth'
export const SWITCH_MODEL_HINT = 'switch model: ctrl+p or /model'
export const COMPACT_HINT = 'compact the conversation: /compact'
export const OPEN_AGENT_HINT = 'open the failed agent: ctrl+g'

const STATIC_HINTS: Partial<Record<ERunRemedy, string>> = {
  [ERunRemedy.FixCredential]: SETTINGS_HINT,
  [ERunRemedy.SwitchModel]: SWITCH_MODEL_HINT,
  [ERunRemedy.Compact]: COMPACT_HINT,
  [ERunRemedy.OpenAgent]: OPEN_AGENT_HINT,
}

const SEPARATOR = ' · '

const RETRY: KeyDeclaration = {
  chord: 'ctrl+r',
  hint: 'retry',
  describe: 'retry a failed turn',
}

const costOf = (args: { durationMs?: number; outputTokens?: number }): string => {
  const parts: string[] = []
  if (args.durationMs !== undefined) parts.push(formatElapsed(args.durationMs))
  if (args.outputTokens !== undefined && args.outputTokens > 0) {
    parts.push(`↓ ${formatTokens(args.outputTokens)}`)
  }
  return parts.join(SEPARATOR)
}

function Header(props: { title: string; cost: string; onDismiss?: () => void }): React.ReactNode {
  return (
    <>
      <text fg={theme.error} bg={theme.panelBg}>{`${glyph.failed} ${props.title}`}</text>
      <box flexGrow={1} />
      {props.cost.length === 0 ? null : (
        <text
          fg={theme.hint}
          bg={theme.panelBg}
          marginRight={props.onDismiss === undefined ? 0 : 1}
        >
          {props.cost}
        </text>
      )}
      {props.onDismiss === undefined ? null : (
        <CloseButton onClose={props.onDismiss} bg={theme.panelBg} />
      )}
    </>
  )
}

const retrySpans = (args: { hovered: boolean; enabled: boolean }): readonly Span[] =>
  args.enabled
    ? [
        { text: `${glyph.retry} ${spellChord(RETRY.chord)}`, fg: theme.accent },
        { text: ` ${RETRY.hint}`, fg: args.hovered ? theme.hover : theme.hint },
      ]
    : [{ text: `${glyph.retry} ${spellChord(RETRY.chord)} ${RETRY.hint}`, fg: theme.hint }]

export function ErrorBlock(props: {
  message: string
  title?: string
  remedies?: readonly RunAttentionRemedy[]
  busyReason?: string | null
  width: number
  durationMs?: number
  outputTokens?: number
  onRetry?: () => void
  onDismiss?: () => void
}): React.ReactNode {
  const retry = useClickRegion(props.onRetry)
  const onRetry = props.onRetry
  const remedies = props.remedies ?? []
  const retryEntry = remedies.find((entry) => entry.remedy === ERunRemedy.Retry)

  useKeyBindings(
    onRetry === undefined
      ? []
      : [
          {
            ...RETRY,
            layer: EKeyLayer.Block,
            group: EKeyGroup.Turn,
            run: onRetry,
          },
        ],
  )

  const hints = remedies.flatMap((entry) => {
    const hint = STATIC_HINTS[entry.remedy]
    return hint === undefined ? [] : [{ remedy: entry.remedy, hint }]
  })

  return (
    <box flexDirection="column" marginBottom={1} flexShrink={0}>
      <Panel
        rail={theme.error}
        fill={theme.overlayBg}
        band={theme.panelBg}
        width={Math.max(1, props.width - TRANSCRIPT_INSET)}
        header={
          <Header
            title={props.title ?? HEADING}
            cost={costOf(props)}
            {...(props.onDismiss === undefined ? {} : { onDismiss: props.onDismiss })}
          />
        }
      >
        <text fg={theme.body} bg={theme.overlayBg}>
          {props.message}
        </text>
        {hints.map((entry) => (
          <text key={entry.remedy} fg={theme.accent} bg={theme.overlayBg}>
            {entry.hint}
          </text>
        ))}
        {props.onRetry === undefined && retryEntry === undefined ? null : (
          <text bg={theme.overlayBg} {...retry.handlers}>
            <Spans
              spans={retrySpans({
                hovered: retry.hovered,
                enabled: props.onRetry !== undefined,
              })}
            />
          </text>
        )}
        {props.onRetry === undefined && props.busyReason != null ? (
          <text fg={theme.hint} bg={theme.overlayBg}>
            {props.busyReason}
          </text>
        ) : null}
      </Panel>
    </box>
  )
}
