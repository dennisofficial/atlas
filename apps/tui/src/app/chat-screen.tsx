import React, { useMemo } from 'react'

import { ESessionConnection } from '@dltech/atlas-client/stream'

import { NoticeStack } from '../ui/components/notice-stack'
import { Spans } from '../ui/components/spans'
import { Transcript } from '../ui/components/transcript'
import { createKeyRegistry, KeyRegistryContext } from '../ui/keys'
import type { PendingRow } from '../store'
import { theme } from '../ui/theme'
import type { SessionComposer } from './use-session-composer'
import type { SessionTranscript } from './use-session-transcript'
import { ComposerPane } from './composer-pane'

const BACK_HINT = '   esc back'

export function ChatScreen(props: {
  transcript: SessionTranscript
  composer: SessionComposer
  pending: readonly PendingRow[]
  width: number
  height: number
  cwd: string
  now: number
  sends: number
  working: boolean
}): React.ReactNode {
  const { composer, transcript } = props
  const registry = useMemo(() => createKeyRegistry(), [])

  return (
    <KeyRegistryContext.Provider value={registry}>
      <box flexDirection="column" flexGrow={1} width={props.width}>
        <box flexShrink={0} paddingLeft={2} paddingRight={2}>
          <text>
            <Spans
              spans={[
                { text: transcript.name ?? transcript.sessionId, fg: theme.body },
                { text: BACK_HINT, fg: theme.hint },
              ]}
            />
          </text>
        </box>
        <Transcript
          model={transcript.model}
          width={props.width}
          now={props.now}
          cwd={props.cwd}
          turn={transcript.turn}
          sends={props.sends}
          pending={props.pending}
          onNearTop={() => void transcript.loadOlder()}
          cloudConnected={transcript.connection === ESessionConnection.Live}
        />
        <ComposerPane
          draft={composer.draft}
          fileMenu={composer.fileMenu}
          highlights={composer.highlights}
          width={props.width}
          height={props.height}
          working={props.working}
          interrupting={false}
          focused
          onCursorMoved={composer.handleCursorMoved}
        />
        <NoticeStack width={props.width} />
      </box>
    </KeyRegistryContext.Provider>
  )
}
