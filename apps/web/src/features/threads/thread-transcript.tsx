'use client'

import { Fragment, memo, type ReactNode } from 'react'
import { CircleAlertIcon, CirclePauseIcon } from 'lucide-react'

import { AgentMessage, UserMessage } from '@dltech/atlas-ui/ai/message'
import { MessageResponse } from '@dltech/atlas-ui/ai/message-response'
import { Reasoning } from '@dltech/atlas-ui/ai/reasoning'
import { SandboxBoot } from '@dltech/atlas-ui/ai/sandbox-boot'
import { WorkSummary } from '@dltech/atlas-ui/ai/work-summary'
import { Chat, ChatItem } from '@dltech/atlas-ui/ai/chat'
import { Alert, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'
import { Trace, TraceIcon, TraceLine, TraceTitle } from '@dltech/atlas-ui/components/trace'
import { formatElapsed } from '@dltech/atlas-client/transcript'
import type { PodStatus } from '@dltech/atlas-wire/web'

import { useSessionUser } from '@/features/settings/session/use-session-identity'

import { bootTimelineOf, EBootEntryKind, type BootEntry } from './data/boot-timeline'
import { clockTimeOf, spanMsOf } from './data/clock-time'
import { messageImagesOf } from './data/message-images'
import { isSameItem } from './data/same-item'
import { rosterModelsOf } from './data/transcript-agents'
import { ETranscriptKind, type TranscriptRow } from './data/transcript'
import {
  ESegmentKind,
  ETurnKind,
  turnsOf,
  type AgentTurn,
  type Segment,
  type Turn,
  type WorkItem as WorkItemData,
} from './data/transcript-turns'
import { useNow } from './data/use-now'
import { useRoster } from './data/use-roster'
import { useThreadPanel } from './panel/thread-panel-context'
import { sandboxBootPropsOf } from './sandbox-boot-props'
import { ReportNotice, SpawnCard } from './transcript/transcript-agents'
import { ToolRow } from './transcript/transcript-tool-row'

const AGENT_AUTHOR = 'Atlas'

function WorkItemView({ item }: { item: WorkItemData }) {
  switch (item.kind) {
    case ETranscriptKind.Thought:
      return <Reasoning text={item.text} live={item.streaming || item.heldOpen} />
    case ETranscriptKind.Tools:
      return (
        <>
          {item.calls.map((call) => (
            <ToolRow key={call.id} call={call} />
          ))}
        </>
      )
  }
}

const WorkItem = memo(WorkItemView, (previous, next) =>
  isSameItem({ previous: previous.item, next: next.item }),
)

function AgentTurnView({
  turn,
  now,
  models,
}: {
  turn: AgentTurn
  now: number
  models: ReadonlyMap<string, string>
}) {
  const final = turn.segments.at(-1)
  const answer = final?.kind === ESegmentKind.Message && final.final ? final : null
  const body = answer === null ? turn.segments : turn.segments.slice(0, -1)
  return (
    <div className="flex flex-col gap-4">
      {body.map((segment) => (
        <SegmentView key={segment.id} segment={segment} now={now} />
      ))}
      {turn.spawns.length === 0 ? null : (
        <div className="flex flex-col gap-3">
          {turn.spawns.map((spawn) => (
            <SpawnCard key={spawn.id} item={spawn} model={models.get(spawn.agentId)} now={now} />
          ))}
        </div>
      )}
      {answer === null ? null : <SegmentView segment={answer} now={now} />}
    </div>
  )
}

function SegmentView({ segment, now }: { segment: Segment; now: number }) {
  if (segment.kind === ESegmentKind.Message) {
    const { item } = segment
    return (
      <AgentMessage
        author={AGENT_AUTHOR}
        timestamp={clockTimeOf(item.at)}
        streaming={item.streaming}
        caret={false}
        copyText={item.text}
      >
        <MessageResponse isAnimating={item.streaming} caret="block">
          {item.text}
        </MessageResponse>
      </AgentMessage>
    )
  }
  const duration = formatElapsed(
    spanMsOf({
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
      now,
      running: segment.running,
    }),
  )
  return (
    <WorkSummary duration={duration} running={segment.running} stepCount={segment.stepCount}>
      {segment.items.map((item) => (
        <WorkItem key={item.id} item={item} />
      ))}
    </WorkSummary>
  )
}

export type TranscriptRewind = {
  points: ReadonlySet<string>
  onRewind: (picked: { eventId: string; text: string }) => void
}

function TurnView({
  turn,
  now,
  models,
  userName,
  rewind,
}: {
  turn: Turn
  now: number
  models: ReadonlyMap<string, string>
  userName: string | undefined
  rewind: TranscriptRewind | null
}) {
  switch (turn.kind) {
    case ETurnKind.User:
      return (
        <UserMessage
          author={userName}
          timestamp={clockTimeOf(turn.item.at)}
          images={messageImagesOf({ id: turn.item.id, images: turn.item.images })}
          onRewind={
            rewind === null || !rewind.points.has(turn.item.id)
              ? undefined
              : () => rewind.onRewind({ eventId: turn.item.id, text: turn.item.text })
          }
        >
          {turn.item.text.trim().length === 0 ? undefined : (
            <p className="whitespace-pre-wrap">{turn.item.text}</p>
          )}
        </UserMessage>
      )
    case ETurnKind.Report:
      return <ReportNotice item={turn.item} />
    case ETurnKind.Agent:
      return <AgentTurnView turn={turn} now={now} models={models} />
  }
}

function ParkedLine() {
  return (
    <Trace>
      <TraceLine>
        <TraceIcon>
          <CirclePauseIcon />
        </TraceIcon>
        <TraceTitle>Sandbox parked</TraceTitle>
      </TraceLine>
    </Trace>
  )
}

function BootEntryItem({ entry, onRetry }: { entry: BootEntry; onRetry: () => void }) {
  return (
    <ChatItem id={entry.id}>
      {entry.kind === EBootEntryKind.Parked ? (
        <ParkedLine />
      ) : (
        <SandboxBoot {...sandboxBootPropsOf(entry.view)} {...(entry.live ? { onRetry } : {})} />
      )}
    </ChatItem>
  )
}

export function ThreadTranscript({
  items,
  failure,
  pod,
  bootNow,
  working,
  onRetryBoot,
  rewind,
}: {
  items: readonly TranscriptRow[]
  failure: string | null
  pod: PodStatus | null
  bootNow: number
  working: boolean
  onRetryBoot: () => void
  rewind: TranscriptRewind | null
}) {
  const { user } = useSessionUser()
  const now = useNow(working)
  const { channel } = useThreadPanel()
  const models = rosterModelsOf(useRoster(channel))
  const turns = turnsOf({ items, working })
  const boot = bootTimelineOf({ turns, pod, now: bootNow })
  const userName = user?.name
  const bootAfter = (index: number): ReactNode =>
    boot
      .filter((entry) => entry.afterIndex === index)
      .map((entry) => <BootEntryItem key={entry.id} entry={entry} onRetry={onRetryBoot} />)
  const lastUserTurnId = turns.findLast((turn) => turn.kind === ETurnKind.User)?.id ?? null
  return (
    <Chat jumpKey={lastUserTurnId}>
      {bootAfter(-1)}
      {turns.map((turn, index) => (
        <Fragment key={turn.id}>
          <ChatItem id={turn.id}>
            <TurnView turn={turn} now={now} models={models} userName={userName} rewind={rewind} />
          </ChatItem>
          {bootAfter(index)}
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
