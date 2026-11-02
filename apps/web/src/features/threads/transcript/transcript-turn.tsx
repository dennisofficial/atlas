'use client'

import { memo } from 'react'

import { AgentMessage, UserMessage } from '@dltech/atlas-ui/ai/message'
import { EMessageImageSize, MessageImageThumb } from '@dltech/atlas-ui/ai/message-images'
import { Reasoning } from '@dltech/atlas-ui/ai/reasoning'
import { WorkSummary } from '@dltech/atlas-ui/ai/work-summary'
import { formatElapsed } from '@dltech/atlas-client/transcript'

import { clockTimeOf, spanMsOf } from '../data/clock-time'
import { messageImagesOf } from '../data/message-images'
import { isSameItem } from '../data/same-item'
import { isSameTurn } from '../data/same-turn'
import { ETranscriptKind } from '../data/transcript'
import {
  ESegmentKind,
  ETurnKind,
  type AgentTurn,
  type Segment,
  type Turn,
  type WorkItem as WorkItemData,
} from '../data/transcript-turns'
import { ReportNotice, SpawnCard } from './transcript-agents'
import { TranscriptNotice } from './transcript-notice'
import { TranscriptMarkdown } from './transcript-markdown'
import { ToolRow } from './transcript-tool-row'

export type TranscriptRewind = {
  points: ReadonlySet<string>
  onRewind: (picked: { eventId: string; text: string }) => void
}

export type TranscriptActions = {
  rewind: TranscriptRewind | null
  openChanges: ((path: string) => void) | null
  openAgent: ((id: string) => void) | null
}

const AGENT_AUTHOR = 'Atlas'

function WorkItemView({
  item,
  onOpenChanges,
}: {
  item: WorkItemData
  onOpenChanges: ((path: string) => void) | null
}) {
  switch (item.kind) {
    case ETranscriptKind.Thought:
      return <Reasoning text={item.text} live={item.streaming || item.heldOpen} />
    case ETranscriptKind.Tools:
      return (
        <>
          {item.calls.map((call) => (
            <ToolRow key={call.id} call={call} onOpenChanges={onOpenChanges} />
          ))}
        </>
      )
  }
}

const WorkItem = memo(
  WorkItemView,
  (previous, next) =>
    isSameItem({ previous: previous.item, next: next.item }) &&
    previous.onOpenChanges === next.onOpenChanges,
)

function AgentTurnView({
  turn,
  now,
  models,
  actions,
}: {
  turn: AgentTurn
  now: number
  models: ReadonlyMap<string, string>
  actions: TranscriptActions
}) {
  const final = turn.segments.at(-1)
  const answer = final?.kind === ESegmentKind.Message && final.final ? final : null
  const body = answer === null ? turn.segments : turn.segments.slice(0, -1)
  return (
    <div className="flex flex-col gap-4">
      {body.map((segment) => (
        <SegmentView
          key={segment.id}
          segment={segment}
          now={now}
          onOpenChanges={actions.openChanges}
        />
      ))}
      {turn.spawns.length === 0 ? null : (
        <div className="flex flex-col gap-3">
          {turn.spawns.map((spawn) => (
            <SpawnCard
              key={spawn.id}
              item={spawn}
              model={models.get(spawn.agentId)}
              now={now}
              onOpenAgent={actions.openAgent}
            />
          ))}
        </div>
      )}
      {answer === null ? null : (
        <SegmentView segment={answer} now={now} onOpenChanges={actions.openChanges} />
      )}
    </div>
  )
}

function SegmentView({
  segment,
  now,
  onOpenChanges,
}: {
  segment: Segment
  now: number
  onOpenChanges: ((path: string) => void) | null
}) {
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
        <TranscriptMarkdown isAnimating={item.streaming}>{item.text}</TranscriptMarkdown>
      </AgentMessage>
    )
  }
  if (segment.kind === ESegmentKind.Images) {
    return (
      <div className="flex flex-col items-start gap-2">
        {segment.images.map((image) => (
          <MessageImageThumb key={image.id} image={image} size={EMessageImageSize.Preview} />
        ))}
      </div>
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
        <WorkItem key={item.id} item={item} onOpenChanges={onOpenChanges} />
      ))}
    </WorkSummary>
  )
}

function TurnViewBody({
  turn,
  now,
  models,
  userName,
  actions,
}: {
  turn: Turn
  now: number
  models: ReadonlyMap<string, string>
  userName: string | undefined
  actions: TranscriptActions
}) {
  const { rewind } = actions
  switch (turn.kind) {
    case ETurnKind.User:
      return (
        <UserMessage
          author={userName}
          timestamp={clockTimeOf(turn.item.at)}
          images={messageImagesOf({
            id: turn.item.id,
            images: turn.item.images,
          })}
          copyText={turn.item.text}
          attachments={(turn.item.uploads ?? []).map((upload) => ({
            id: upload.uploadId,
            label: upload.name,
          }))}
          onRewind={
            rewind === null || !rewind.points.has(turn.item.id)
              ? undefined
              : () =>
                  rewind.onRewind({
                    eventId: turn.item.id,
                    text: turn.item.text,
                  })
          }
        >
          {turn.item.text.trim().length === 0 ? undefined : (
            <TranscriptMarkdown>{turn.item.text}</TranscriptMarkdown>
          )}
        </UserMessage>
      )
    case ETurnKind.Report:
      return <ReportNotice item={turn.item} onOpenAgent={actions.openAgent} />
    case ETurnKind.Notice:
      return <TranscriptNotice item={turn.item} />
    case ETurnKind.Agent:
      return <AgentTurnView turn={turn} now={now} models={models} actions={actions} />
  }
}

export const TurnView = memo(
  TurnViewBody,
  (previous, next) =>
    isSameTurn({ previous: previous.turn, next: next.turn }) &&
    previous.now === next.now &&
    previous.models === next.models &&
    previous.userName === next.userName &&
    previous.actions === next.actions,
)
