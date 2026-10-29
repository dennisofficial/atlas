'use client'

import { Fragment, useMemo, type ReactNode } from 'react'
import { CircleAlertIcon, CirclePauseIcon } from 'lucide-react'

import { SandboxBoot } from '@dltech/atlas-ui/ai/sandbox-boot'
import { Chat, ChatItem } from '@dltech/atlas-ui/ai/chat'
import { Alert, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'
import { Trace, TraceIcon, TraceLine, TraceTitle } from '@dltech/atlas-ui/components/trace'
import type { PodStatus } from '@dltech/atlas-wire/web'

import { useSessionUser } from '@/features/settings/session/use-session-identity'

import { bootTimelineOf, EBootEntryKind, type BootEntry } from './data/boot-timeline'
import { rosterModelsOf } from './data/transcript-agents'
import { type TranscriptRow } from './data/transcript'
import { ETurnKind, turnsOf } from './data/transcript-turns'
import { useNow } from './data/use-now'
import { useRoster } from './data/use-roster'
import { useThreadPanel } from './panel/thread-panel-context'
import { sandboxBootPropsOf } from './sandbox-boot-props'
import { TurnView, type TranscriptRewind } from './transcript/transcript-turn'

export type { TranscriptRewind }

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
  const { channel, openChanges, openAgent } = useThreadPanel()
  const models = rosterModelsOf(useRoster(channel))
  const turns = turnsOf({ items, working })
  const boot = bootTimelineOf({ turns, pod, now: bootNow })
  const userName = user?.name
  const actions = useMemo(
    () => ({ rewind, openChanges, openAgent }),
    [rewind, openChanges, openAgent],
  )
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
            <TurnView turn={turn} now={now} models={models} userName={userName} actions={actions} />
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
