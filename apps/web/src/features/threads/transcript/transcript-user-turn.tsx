'use client'

import { UserMessage } from '@dltech/atlas-ui/ai/message'
import { messageTimeOf } from '@dltech/atlas-client/transcript'

import { CommandMessageRow } from '@/features/sessions/command-message-row'

import { useAttachmentViews } from '../data/use-attachment-views'
import type { UserTurn } from '../data/transcript-turns'
import type { TranscriptSummarise } from '../data/use-summarise'
import { useOptionalThreadPanel } from '../panel/thread-panel-context'
import { TranscriptMarkdown } from './transcript-markdown'
import type { TranscriptRewind } from './transcript-turn'

export type QueuedTurnActions = {
  label: string
  disabled: boolean
  onEdit: () => void
  onRemove: () => void
}

function summariseHandlerOf(args: {
  summarise: TranscriptSummarise | null
  eventId: string
}): (() => void) | undefined {
  const { summarise, eventId } = args
  if (summarise === null || !summarise.points.has(eventId)) return undefined
  return () => summarise.onSummarise(eventId)
}

export function UserTurnView({
  turn,
  now,
  userName,
  rewind,
  summarise,
  queued,
}: {
  turn: UserTurn
  now: number
  userName: string | undefined
  rewind: TranscriptRewind | null
  summarise: TranscriptSummarise | null
  queued: QueuedTurnActions | undefined
}) {
  const panel = useOptionalThreadPanel()
  const attachments = useAttachmentViews({
    sessionId: panel?.threadId,
    attachments: turn.item.attachments,
  })
  if (turn.item.command !== undefined)
    return (
      <CommandMessageRow
        text={turn.item.command.text}
        timestamp={messageTimeOf({ at: turn.item.at, now })}
      />
    )
  const body =
    turn.item.text.trim().length === 0 ? undefined : (
      <TranscriptMarkdown breaks repairDiagrams={false}>
        {turn.item.text}
      </TranscriptMarkdown>
    )
  if (queued !== undefined)
    return (
      <UserMessage
        author={userName}
        timestamp={queued.label}
        copyText={turn.item.text}
        attachments={attachments}
        actionsDisabled={queued.disabled}
        onEdit={queued.onEdit}
        onRemove={queued.onRemove}
      >
        {body}
      </UserMessage>
    )
  return (
    <UserMessage
      author={userName}
      timestamp={messageTimeOf({ at: turn.item.at, now })}
      copyText={turn.item.text}
      attachments={attachments}
      onRewind={
        rewind === null || !rewind.points.has(turn.item.id)
          ? undefined
          : () =>
              rewind.onRewind({
                eventId: turn.item.id,
                text: turn.item.text,
              })
      }
      onSummariseUpTo={summariseHandlerOf({ summarise, eventId: turn.item.id })}
    >
      {body}
    </UserMessage>
  )
}
