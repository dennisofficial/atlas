import { ESessionConnection } from '@dltech/atlas-client/stream'
import React from 'react'

import { Spans } from '../ui/components/spans'
import { Transcript } from '../ui/components/transcript'
import { theme } from '../ui/theme'
import type { SessionTranscript } from './use-session-transcript'

const BACK_HINT = '   esc back'

export function TranscriptScreen(props: {
  transcript: SessionTranscript
  width: number
  cwd: string
  now: number
}): React.ReactNode {
  const { transcript } = props

  return (
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
        onNearTop={() => void transcript.loadOlder()}
        cloudConnected={transcript.connection === ESessionConnection.Live}
      />
    </box>
  )
}
