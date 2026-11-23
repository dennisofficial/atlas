import React, { useMemo } from 'react'

import { NoticeStack } from '../ui/components/notice-stack'
import { OperatorInputOverlay } from '../ui/components/operator-input'
import { Spans, type Span } from '../ui/components/spans'
import { Transcript } from '../ui/components/transcript'
import { createKeyRegistry, KeyRegistryContext } from '../ui/keys'
import type { PendingRow } from '../store'
import { theme } from '../ui/theme'
import type { ConnectionView } from './connection-view'
import type { OperatorInputControl } from './use-operator-input'
import type { SessionComposer } from './use-session-composer'
import type { SessionTranscript } from './use-session-transcript'
import { modelWithAttentionFailure, type RunAttentionControl } from './use-run-attention'
import { EPodWake, type PodWake } from './use-session-wake'
import { ComposerPane } from './composer-pane'

const BACK_HINT = '   esc back'

const noop = (): void => undefined

const controlHints = (args: { working: boolean; wake: PodWake }): readonly Span[] => [
  ...(args.working ? [{ text: '   esc stop', fg: theme.hint }] : []),
  ...(args.wake.state === EPodWake.Asleep ? [] : [{ text: '   r wake', fg: theme.hint }]),
]

export function ChatScreen(props: {
  transcript: SessionTranscript
  composer: SessionComposer
  pending: readonly PendingRow[]
  operator: OperatorInputControl
  attention: RunAttentionControl
  connection: ConnectionView
  wake: PodWake
  width: number
  height: number
  cwd: string
  now: number
  sends: number
  working: boolean
  onReconnect: () => void
  choosingModel: boolean
}): React.ReactNode {
  const { composer, transcript, attention, operator, connection, wake } = props
  const registry = useMemo(() => createKeyRegistry(), [])
  const hints = controlHints({ working: props.working, wake })
  const model = modelWithAttentionFailure({
    model: transcript.model,
    attention: attention.attention,
    working: props.working,
  })

  return (
    <KeyRegistryContext.Provider value={registry}>
      <box flexDirection="column" flexGrow={1} width={props.width}>
        <box flexShrink={0} paddingLeft={2} paddingRight={2}>
          <text>
            <Spans
              spans={[
                { text: transcript.name ?? transcript.sessionId, fg: theme.body },
                { text: BACK_HINT, fg: theme.hint },
                ...hints,
              ]}
            />
          </text>
        </box>
        <Transcript
          model={model}
          width={props.width}
          now={props.now}
          cwd={props.cwd}
          turn={transcript.turn}
          sends={props.sends}
          pending={props.pending}
          onNearTop={() => void transcript.loadOlder()}
          cloudConnected={connection.cloudConnected}
          reconnecting={connection.reconnecting}
          disconnected={connection.disconnected}
          waking={connection.waking}
          stale={connection.stale}
          onReconnect={props.onReconnect}
          attention={attention.attention}
          {...(attention.handleRetry === null ? {} : { onRetry: attention.handleRetry })}
          {...(attention.handleDismiss === null
            ? {}
            : { onDismissFailure: attention.handleDismiss })}
          {...(attention.handleResume === null ? {} : { onResume: attention.handleResume })}
        />
        {operator.state === null ? null : (
          <OperatorInputOverlay
            width={props.width}
            state={operator.state}
            editor={operator.editor}
            onChange={operator.handleChange}
            onPaste={operator.handlePaste}
            onSubmit={operator.handleSubmit}
            onOpenUrl={noop}
          />
        )}
        <ComposerPane
          draft={composer.draft}
          fileMenu={composer.fileMenu}
          highlights={composer.highlights}
          width={props.width}
          height={props.height}
          working={props.working}
          interrupting={false}
          focused={operator.state === null && !props.choosingModel}
          onCursorMoved={composer.handleCursorMoved}
        />
        <NoticeStack width={props.width} />
      </box>
    </KeyRegistryContext.Provider>
  )
}
