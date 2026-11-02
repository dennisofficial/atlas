'use client'

import { useMemo } from 'react'
import { CircleAlertIcon, WifiOffIcon } from 'lucide-react'

import { AgentMessage, UserMessage } from '@dltech/atlas-ui/ai/message'
import { EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'
import type { AgentsPanelAgent } from '@dltech/atlas-ui/ai/agents-panel'
import { Chat, ChatItem } from '@dltech/atlas-ui/ai/chat'
import { MessageResponse } from '@dltech/atlas-ui/ai/message-response'
import { Alert, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { isLiveTurn } from '../../data/is-live-turn'
import { eventsFromWire } from '../../data/events-from-wire'
import { rosterModelsOf } from '../../data/transcript-agents'
import { durableTranscriptOf, transcriptViewOf } from '../../data/transcript-items'
import { ESegmentKind, ETurnKind, turnsOf, type Turn } from '../../data/transcript-turns'
import { useNow } from '../../data/use-now'
import { useRoster } from '../../data/use-roster'
import { useThreadEvents } from '../../data/use-thread-events'
import { useThreadSignals } from '../../data/use-thread-signals'
import { TurnView, type TranscriptActions } from '../../transcript/transcript-turn'
import { TabPlaceholder } from '../tab-placeholder'
import { useThreadPanel } from '../thread-panel-context'
import { TranscriptLoading } from './agents-skeletons'

const NO_MODELS: ReadonlyMap<string, string> = new Map()

const hasFinalAnswer = (turns: readonly Turn[]): boolean =>
  turns.some(
    (turn) =>
      turn.kind === ETurnKind.Agent &&
      turn.segments.some((segment) => segment.kind === ESegmentKind.Message && segment.final),
  )

function Outcome({ agent }: { agent: AgentsPanelAgent }) {
  if (agent.display === EAgentDisplay.Failed) {
    return (
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>The run failed</AlertTitle>
        <AlertDescription>{agent.errorText}</AlertDescription>
      </Alert>
    )
  }
  return <AgentMessage author="Atlas">{agent.report}</AgentMessage>
}

export function AgentTranscriptBody(props: {
  events: readonly WireEvent[]
  fallback: AgentsPanelAgent
  running: boolean
  now: number
  models: ReadonlyMap<string, string>
  actions: TranscriptActions
}) {
  const { events, fallback, running, now, models, actions } = props
  const turns = useMemo(() => {
    const view = transcriptViewOf({
      durable: durableTranscriptOf({ events: eventsFromWire(events) }),
      live: [],
    })
    return turnsOf({ items: view.items, working: running })
  }, [events, running])
  const needsOutcome =
    !running &&
    !hasFinalAnswer(turns) &&
    (fallback.display === EAgentDisplay.Failed || fallback.report !== undefined)
  const lastTurnId = turns.findLast((turn) => turn.kind === ETurnKind.User)?.id ?? null

  return (
    <Chat jumpKey={lastTurnId}>
      {turns.length === 0 ? (
        <ChatItem id="brief">
          <UserMessage>
            <MessageResponse>{fallback.brief}</MessageResponse>
          </UserMessage>
        </ChatItem>
      ) : null}
      {turns.map((turn) => (
        <ChatItem key={turn.id} id={turn.id}>
          <TurnView
            turn={turn}
            now={isLiveTurn(turn) ? now : 0}
            models={models}
            userName={undefined}
            actions={actions}
          />
        </ChatItem>
      ))}
      {needsOutcome ? (
        <ChatItem id="outcome">
          <Outcome agent={fallback} />
        </ChatItem>
      ) : null}
    </Chat>
  )
}

export function AgentTranscript(props: { agentId: string; fallback: AgentsPanelAgent }) {
  const { agentId, fallback } = props
  const { channel, openAgent } = useThreadPanel()
  const signals = useThreadSignals(agentId)
  const { events, loaded, error } = useThreadEvents({ threadId: agentId, signals, enabled: true })
  const running = fallback.display === EAgentDisplay.Running
  const now = useNow(running)
  const roster = useRoster(channel)
  const models = useMemo(() => (roster === null ? NO_MODELS : rosterModelsOf(roster)), [roster])
  const actions = useMemo<TranscriptActions>(
    () => ({ rewind: null, openChanges: null, openAgent }),
    [openAgent],
  )

  if (!loaded && error !== null) {
    return (
      <TabPlaceholder
        icon={<WifiOffIcon />}
        title="Transcript unavailable"
        description={error.message}
      />
    )
  }
  if (!loaded) return <TranscriptLoading />
  return (
    <AgentTranscriptBody
      events={events}
      fallback={fallback}
      running={running}
      now={now}
      models={models}
      actions={actions}
    />
  )
}
