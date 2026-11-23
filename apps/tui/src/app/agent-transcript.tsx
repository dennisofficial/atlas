import { ESessionConnection } from '@dltech/atlas-client/stream'
import React from 'react'

import { Spans } from '../ui/components/spans'
import { Transcript } from '../ui/components/transcript'
import { theme } from '../ui/theme'
import type { SessionClient } from './session-client'
import { useSessionTranscript } from './use-session-transcript'

export function AgentTranscriptScreen(props: {
  client: SessionClient
  sessionId: string
  agentId: string
  name: string
  width: number
  cwd: string
  now: () => number
  backLabel: string | null
  onBack: () => void
}): React.ReactNode {
  const transcript = useSessionTranscript({
    client: props.client,
    sessionId: props.sessionId,
    threadId: props.agentId,
    title: props.name,
    now: props.now,
  })

  return (
    <box flexDirection="column" flexGrow={1} width={props.width}>
      <box flexShrink={0} paddingLeft={2} paddingRight={2}>
        <text>
          <Spans
            spans={[
              { text: transcript.name ?? props.agentId, fg: theme.body },
              ...(props.backLabel === null
                ? []
                : [{ text: `   esc ${props.backLabel}`, fg: theme.hint }]),
            ]}
          />
        </text>
      </box>
      <Transcript
        model={transcript.model}
        width={props.width}
        now={props.now()}
        cwd={props.cwd}
        turn={transcript.turn}
        onNearTop={() => void transcript.loadOlder()}
        cloudConnected={transcript.connection === ESessionConnection.Live}
      />
    </box>
  )
}
