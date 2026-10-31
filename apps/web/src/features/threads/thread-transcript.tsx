'use client'

import { useMemo, type ReactNode } from 'react'
import { CirclePauseIcon } from 'lucide-react'

import { SandboxBoot } from '@dltech/atlas-ui/ai/sandbox-boot'
import { Chat, ChatItem } from '@dltech/atlas-ui/ai/chat'
import { RunFailedMarker } from '@dltech/atlas-ui/ai/run-failed-marker'
import { Trace, TraceIcon, TraceLine, TraceTitle } from '@dltech/atlas-ui/components/trace'
import type { PodStatus } from '@dltech/atlas-wire/web'

import { useSessionUser } from '@/features/settings/session/use-session-identity'

import { bootTimelineOf, EBootEntryKind, type BootEntry } from './data/boot-timeline'
import type { BootView } from './data/boot-view'
import { anySpawnRunning, rosterModelsOf } from './data/transcript-agents'
import { type TranscriptRow } from './data/transcript'
import { isLiveTurn } from './data/is-live-turn'
import { ETurnKind, turnsOf } from './data/transcript-turns'
import { useNow, useNowEvery } from './data/use-now'
import { useRoster } from './data/use-roster'
import { useThreadPanel } from './panel/thread-panel-context'
import { sandboxBootPropsOf } from './sandbox-boot-props'
import { RunFailureCard, type RunFailureCardProps } from './transcript/run-failure-card'
import { TurnView, type TranscriptRewind } from './transcript/transcript-turn'

export type { TranscriptRewind }

const BOOT_TICK_MS = 100

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

function TickingSandboxBoot({ view, onRetry }: { view: BootView; onRetry?: () => void }) {
  const { startedAtMs } = view
  const now = useNowEvery({
    enabled: startedAtMs !== undefined,
    tickMs: BOOT_TICK_MS,
  })
  const ticked =
    startedAtMs === undefined ? view : { ...view, elapsedMs: Math.max(0, now - startedAtMs) }
  return <SandboxBoot {...sandboxBootPropsOf(ticked)} {...(onRetry ? { onRetry } : {})} />
}

function BootEntryItem({ entry, onRetry }: { entry: BootEntry; onRetry: () => void }) {
  return (
    <ChatItem id={entry.id}>
      {entry.kind === EBootEntryKind.Parked ? (
        <ParkedLine />
      ) : entry.live ? (
        <TickingSandboxBoot view={entry.view} onRetry={onRetry} />
      ) : (
        <SandboxBoot {...sandboxBootPropsOf(entry.view)} />
      )}
    </ChatItem>
  )
}

export function ThreadTranscript({
  items,
  failureCard,
  failedLabel,
  pod,
  working,
  onRetryBoot,
  rewind,
}: {
  items: readonly TranscriptRow[]
  failureCard: RunFailureCardProps | null
  failedLabel: string | null
  pod: PodStatus | null
  working: boolean
  onRetryBoot: () => void
  rewind: TranscriptRewind | null
}) {
  const { user } = useSessionUser()
  const now = useNow(working || anySpawnRunning(items))
  const { channel, openChanges, openAgent } = useThreadPanel()
  const roster = useRoster(channel)
  const models = useMemo(() => rosterModelsOf(roster), [roster])
  const turns = useMemo(() => turnsOf({ items, working }), [items, working])
  const boot = useMemo(() => bootTimelineOf({ turns, pod, now: 0 }), [turns, pod])
  const userName = user?.name
  const actions = useMemo(
    () => ({ rewind, openChanges, openAgent }),
    [rewind, openChanges, openAgent],
  )
  const bootAfter = (index: number): ReactNode[] =>
    boot
      .filter((entry) => entry.afterIndex === index)
      .map((entry) => <BootEntryItem key={entry.id} entry={entry} onRetry={onRetryBoot} />)
  const lastUserTurnId = turns.findLast((turn) => turn.kind === ETurnKind.User)?.id ?? null
  return (
    <Chat jumpKey={lastUserTurnId}>
      {bootAfter(-1)}
      {turns.flatMap((turn, index) => [
        <ChatItem key={turn.id} id={turn.id}>
          <TurnView
            turn={turn}
            now={isLiveTurn(turn) ? now : 0}
            models={models}
            userName={userName}
            actions={actions}
          />
        </ChatItem>,
        ...bootAfter(index),
      ])}
      {failureCard !== null ? (
        <ChatItem id="turn-failure">
          <RunFailureCard {...failureCard} />
        </ChatItem>
      ) : failedLabel === null ? null : (
        <ChatItem id="turn-failure">
          <RunFailedMarker label={failedLabel} />
        </ChatItem>
      )}
    </Chat>
  )
}
