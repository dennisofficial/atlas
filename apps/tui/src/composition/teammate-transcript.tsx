import { EAgentStatus } from '@dltech/atlas-core'
import type { AgentSnapshot } from '@dltech/atlas-harness'
import React from 'react'

import type { EThinkingVisibility } from '../store'
import { Transcript } from '../ui/components/transcript'
import type { AtlasApp } from './compose'
import { transcriptOfTurn, turnOfChild } from './turn-progress'
import { useTickingNow } from './use-ticking-now'
import { EThreadRows, useThreadView } from './use-thread-view'

/**
 * A teammate's transcript: the same view a sub-agent gets, mounted while the tile is scoped to the
 * teammate rather than opened on one of its children. Kept beside `SubagentTranscript` rather than
 * shared with it because the two mount under different chrome — a scoped teammate carries the pill
 * and the scoped sidebar, an opened child does not.
 */
export function TeammateTranscript(props: {
  app: AtlasApp
  agent: AgentSnapshot
  thinking: EThinkingVisibility
  width: number
  cwd: string
  opened: ReadonlySet<string>
  onToggle: (key: string) => void
}): React.ReactNode {
  const running = props.agent.status === EAgentStatus.Running

  const view = useThreadView({
    app: props.app,
    threadId: props.agent.agentId,
    rows: EThreadRows.Own,
    thinking: props.thinking,
    readClock: Date.now,
  })

  const now = useTickingNow(running)

  return (
    <Transcript
      model={transcriptOfTurn({ model: view.model, working: running, failure: null })}
      width={props.width}
      now={now}
      cwd={props.cwd}
      turn={turnOfChild({
        observed: view.turn,
        running,
        steppingSince: props.agent.steppingSince ?? null,
      })}
      opened={props.opened}
      onToggle={props.onToggle}
    />
  )
}
