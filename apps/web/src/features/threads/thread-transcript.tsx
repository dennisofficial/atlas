'use client'

import { Fragment, type ReactNode } from 'react'
import { BotIcon, CircleAlertIcon, ListChecksIcon, WrenchIcon } from 'lucide-react'

import { AgentMessage, UserMessage } from '@dltech/atlas-ui/ai/message'
import { MessageResponse } from '@dltech/atlas-ui/ai/message-response'
import { Reasoning } from '@dltech/atlas-ui/ai/reasoning'
import { SandboxBoot } from '@dltech/atlas-ui/ai/sandbox-boot'
import { Tool } from '@dltech/atlas-ui/ai/tool'
import { WorkSummary } from '@dltech/atlas-ui/ai/work-summary'
import { Chat, ChatItem } from '@dltech/atlas-ui/ai/chat'
import { Alert, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'
import { formatElapsed } from '@dltech/atlas-client/transcript'

import { useSessionUser } from '@/features/settings/session/use-session-identity'

import type { BootView } from './data/boot-view'
import { clockTimeOf, spanMsOf } from './data/clock-time'
import { ETranscriptKind, type TranscriptItem } from './data/transcript'
import { EToolFamily, type ToolCallItem } from './data/transcript-items'
import { ETurnKind, turnsOf, type AgentTurn } from './data/transcript-turns'
import { useNow } from './data/use-now'
import { sandboxBootPropsOf } from './sandbox-boot-props'

const AGENT_AUTHOR = 'Atlas'

const ICON_OF_FAMILY: Record<EToolFamily, ReactNode> = {
  [EToolFamily.Agent]: <BotIcon />,
  [EToolFamily.Plan]: <ListChecksIcon />,
  [EToolFamily.Other]: <WrenchIcon />,
}

function ToolRow({ call }: { call: ToolCallItem }) {
  return (
    <Tool
      kind={call.kind}
      state={call.state}
      label={call.label}
      title={call.title}
      icon={call.family === undefined ? undefined : ICON_OF_FAMILY[call.family]}
      output={call.output}
      errorText={call.errorText}
      elapsed={call.elapsed}
    />
  )
}

function WorkItem({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case ETranscriptKind.Thought:
      return <Reasoning text={item.text} running={item.streaming} />
    case ETranscriptKind.Tools:
      return (
        <>
          {item.calls.map((call) => (
            <ToolRow key={call.id} call={call} />
          ))}
        </>
      )
    case ETranscriptKind.Agent:
      return (
        <div className="text-sm text-muted-foreground">
          <MessageResponse isAnimating={item.streaming} caret="block">
            {item.text}
          </MessageResponse>
        </div>
      )
    case ETranscriptKind.User:
      return null
  }
}

function AgentTurnView({ turn, now }: { turn: AgentTurn; now: number }) {
  const showSummary = turn.work.length > 0 || turn.running
  const duration = formatElapsed(
    spanMsOf({
      startedAt: turn.startedAt,
      endedAt: turn.endedAt,
      now,
      running: turn.running,
    }),
  )
  const { answer } = turn
  return (
    <div className="flex flex-col gap-4">
      {showSummary ? (
        <WorkSummary duration={duration} running={turn.running} stepCount={turn.stepCount}>
          {turn.work.map((item) => (
            <WorkItem key={item.id} item={item} />
          ))}
        </WorkSummary>
      ) : null}
      {answer === null ? null : (
        <AgentMessage
          author={AGENT_AUTHOR}
          timestamp={clockTimeOf(answer.at)}
          streaming={answer.streaming}
          caret={false}
          copyText={answer.text}
        >
          <MessageResponse isAnimating={answer.streaming} caret="block">
            {answer.text}
          </MessageResponse>
        </AgentMessage>
      )}
    </div>
  )
}

export function ThreadTranscript({
  items,
  failure,
  boot,
  working,
  onRetryBoot,
}: {
  items: readonly TranscriptItem[]
  failure: string | null
  boot: BootView | null
  working: boolean
  onRetryBoot: () => void
}) {
  const { user } = useSessionUser()
  const now = useNow(working)
  const turns = turnsOf({ items, working })
  const bootAfter = turns.findIndex((turn) => turn.kind === ETurnKind.User)
  const userName = user?.name
  const bootNode: ReactNode =
    boot === null ? null : (
      <ChatItem id="sandbox-boot">
        <SandboxBoot {...sandboxBootPropsOf(boot)} onRetry={onRetryBoot} />
      </ChatItem>
    )
  return (
    <Chat>
      {bootAfter === -1 ? bootNode : null}
      {turns.map((turn, index) => (
        <Fragment key={turn.id}>
          <ChatItem id={turn.id}>
            {turn.kind === ETurnKind.User ? (
              <UserMessage author={userName} timestamp={clockTimeOf(turn.item.at)}>
                <p className="whitespace-pre-wrap">{turn.item.text}</p>
              </UserMessage>
            ) : (
              <AgentTurnView turn={turn} now={now} />
            )}
          </ChatItem>
          {index === bootAfter ? bootNode : null}
        </Fragment>
      ))}
      {failure === null ? null : (
        <ChatItem id="turn-failure">
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>The run failed</AlertTitle>
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        </ChatItem>
      )}
    </Chat>
  )
}
