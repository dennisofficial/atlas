'use client'

import { useMemo, type ReactNode } from 'react'
import { CirclePauseIcon } from 'lucide-react'

import { isWaiting, type BackgroundWork } from '@dltech/atlas-client/crew'
import { SandboxBoot } from '@dltech/atlas-ui/ai/sandbox-boot'
import { Chat, ChatItem } from '@dltech/atlas-ui/ai/chat'
import { RunFailedMarker } from '@dltech/atlas-ui/ai/run-failed-marker'
import { Trace, TraceIcon, TraceLine, TraceTitle } from '@dltech/atlas-ui/components/trace'
import type { PodStatus } from '@dltech/atlas-wire/web'

import { useSessionUser } from '@/features/settings/session/use-session-identity'
import type { QueuedTranscript } from '@/features/sessions/data/queued-transcript'

import { bootTimelineOf, EBootEntryKind, type BootEntry } from './data/boot-timeline'
import type { BootView } from './data/boot-view'
import { anySpawnRunning, rosterModelsOf } from './data/transcript-agents'
import { type TranscriptRow } from './data/transcript'
import { isLiveTurn } from './data/is-live-turn'
import { ETurnKind, lastTurnEndedAt, turnsOf, type Turn } from './data/transcript-turns'
import { useNow, useNowEvery } from './data/use-now'
import { useRoster } from './data/use-roster'
import { useThreadPanel } from './panel/thread-panel-context'
import { sandboxBootPropsOf } from './sandbox-boot-props'
import { BackgroundWaitLine } from './transcript/background-wait-line'
import { RepairCard, type RepairCardProps } from './transcript/repair-card'
import { RunFailureCard, type RunFailureCardProps } from './transcript/run-failure-card'
import { QueuedRowItem } from './transcript/queued-row'
import {
  TurnView,
  type TranscriptRewind,
  type TranscriptSummarise,
} from './transcript/transcript-turn'
import type { TranscriptResume } from './transcript/stopped-line'
import { ToolPictureSessionProvider } from './transcript/tool-picture-session'

export type { TranscriptResume, TranscriptRewind, TranscriptSummarise }

const BOOT_TICK_MS = 100

const chatKeyOf = (turn: Turn): string =>
  turn.kind === ETurnKind.User && turn.item.clientId !== undefined ? turn.item.clientId : turn.id

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
        <SandboxBoot {...sandboxBootPropsOf(entry.view)} onRetry={onRetry} />
      )}
    </ChatItem>
  )
}

export function ThreadTranscript({
  sessionId,
  items,
  failureCard,
  repairCard,
  failedLabel,
  pod,
  working,
  turnStartedAt,
  background,
  onRetryBoot,
  rewind,
  summarise,
  resume,
  boot: sessionBoot,
  queued,
  onLoadOlder,
  onOpenPodSize,
}: {
  sessionId: string
  items: readonly TranscriptRow[]
  failureCard: RunFailureCardProps | null
  repairCard?: RepairCardProps | null
  failedLabel: string | null
  pod: PodStatus | null
  working: boolean
  turnStartedAt?: string | undefined
  /** What the session left running: a live row while the turn is over and it is still out there. */
  background: BackgroundWork
  onRetryBoot: () => void
  rewind: TranscriptRewind | null
  summarise: TranscriptSummarise | null
  resume?: TranscriptResume | null
  onOpenPodSize?: (() => void) | undefined
  boot?: BootView | null
  queued?: QueuedTranscript
  onLoadOlder?: () => Promise<number>
}) {
  const { user } = useSessionUser()
  const now = useNow(working || anySpawnRunning(items))
  const { channel, openChanges, openAgent } = useThreadPanel()
  const roster = useRoster(channel)
  const models = useMemo(() => rosterModelsOf(roster), [roster])
  const turns = useMemo(
    () => turnsOf({ items, working, turnStartedAt }),
    [items, working, turnStartedAt],
  )
  const settledAt = useMemo(() => lastTurnEndedAt(turns), [turns])
  const boot = useMemo(() => bootTimelineOf({ turns, pod, now: 0 }), [turns, pod])
  const userName = user?.name
  const actions = useMemo(
    () => ({
      rewind,
      summarise,
      resume: resume ?? null,
      openChanges,
      openAgent,
      openPodSize: onOpenPodSize ?? null,
    }),
    [rewind, summarise, resume, openChanges, openAgent, onOpenPodSize],
  )
  const bootAfter = (index: number): ReactNode[] =>
    boot
      .filter((entry) => entry.afterIndex === index)
      .map((entry) => <BootEntryItem key={entry.id} entry={entry} onRetry={onRetryBoot} />)
  const lastUserTurn = turns.findLast((turn) => turn.kind === ETurnKind.User)
  const lastUserTurnId = lastUserTurn === undefined ? null : chatKeyOf(lastUserTurn)
  return (
    <ToolPictureSessionProvider value={sessionId}>
      <Chat jumpKey={lastUserTurnId} {...(onLoadOlder === undefined ? {} : { onLoadOlder })}>
        {sessionBoot === undefined || sessionBoot === null ? null : (
          <ChatItem id="session-boot">
            <TickingSandboxBoot view={sessionBoot} onRetry={onRetryBoot} />
          </ChatItem>
        )}
        {bootAfter(-1)}
        {turns.flatMap((turn, index) => [
          <ChatItem key={chatKeyOf(turn)} id={turn.id}>
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
        {repairCard === undefined || repairCard === null ? null : (
          <ChatItem id="turn-failure">
            <RepairCard {...repairCard} />
          </ChatItem>
        )}
        {failureCard !== null ? (
          <ChatItem id="turn-failure">
            <RunFailureCard {...failureCard} />
          </ChatItem>
        ) : failedLabel === null ? null : (
          <ChatItem id="turn-failure">
            <RunFailedMarker label={failedLabel} />
          </ChatItem>
        )}
        {working || !isWaiting(background) ? null : (
          <ChatItem id="background-wait">
            <BackgroundWaitLine work={background} settledAt={settledAt} />
          </ChatItem>
        )}
        {queued === undefined
          ? null
          : queued.rows.map((row) => (
              <ChatItem key={row.id} id={row.id}>
                <QueuedRowItem
                  row={row}
                  now={now}
                  models={models}
                  userName={userName}
                  actions={actions}
                  waitLabel={queued.waitLabel}
                  onEdit={queued.onEdit}
                  onRemove={queued.onRemove}
                />
              </ChatItem>
            ))}
      </Chat>
    </ToolPictureSessionProvider>
  )
}
