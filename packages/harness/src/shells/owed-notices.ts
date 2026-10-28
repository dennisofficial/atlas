import {
  deliveredDraftOf,
  EShellStatus,
  owedNotices,
  type Event,
  type ThreadId,
} from '@dltech/atlas-core'

import type { ShellSnapshot } from './background-shell'
import { ENotice, type ShellAttentionQueue } from './attention'
import { toShellId } from './shell-id'

type ShellArrival = Extract<
  Event,
  {
    type: 'background-shell-ended' | 'background-shell-matched' | 'background-shell-awaiting-input'
  }
>

const isShellArrival = (event: Event): event is ShellArrival =>
  event.type === 'background-shell-ended' ||
  event.type === 'background-shell-matched' ||
  event.type === 'background-shell-awaiting-input'

const kindOf = (event: ShellArrival): ENotice => {
  if (event.type === 'background-shell-ended') return ENotice.Ended
  if (event.type === 'background-shell-matched') return ENotice.Matched
  return ENotice.AwaitingInput
}

function snapshotOfArrival({
  event,
  threadId,
}: {
  event: ShellArrival
  threadId: ThreadId
}): ShellSnapshot {
  const ended = event.type === 'background-shell-ended'
  return {
    shellId: toShellId(event.shellId),
    threadId,
    bootId: event.bootId,
    command: event.command,
    description: event.description ?? '',
    status: ended ? event.status : EShellStatus.Running,
    killedBy: ended ? event.killedBy : undefined,
    exitCode: ended ? event.exitCode : undefined,
    startedAt: event.at,
    lastOutputAt: event.at,
    endedAt: ended ? event.at : undefined,
    totalCharacters: 0,
    awaitingInput: event.type === 'background-shell-awaiting-input',
    outputPath: event.outputPath,
  }
}

export function requeueOwedShellNotices({
  events,
  threadId,
  notices,
}: {
  events: readonly Event[]
  threadId: ThreadId
  notices: ShellAttentionQueue
}): void {
  for (const arrival of owedNotices(events)) {
    if (arrival.threadId !== threadId || !isShellArrival(arrival)) continue

    const draft = deliveredDraftOf(arrival)
    if (draft === undefined) continue
    notices.queue({
      threadId,
      kind: kindOf(arrival),
      snapshot: snapshotOfArrival({ event: arrival, threadId }),
      draft,
    })
  }
}
