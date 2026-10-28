import {
  currentContextEvents,
  isNoticeArrival,
  latestTldrPerAnchor,
  type Event,
  type SaidImage,
} from '@dltech/atlas-core'

import { entriesOfAssistantEvent, saidWhileToolsWereOutstanding } from './assistant-entries'
import {
  contextLoadedWith,
  contextRuns,
  isRelocationMarker,
  NOTHING_ATTACHED,
} from './context-entries'
import { inOneBreath, locationChangedEntry } from './entry-folds'
import { noticeEntriesOf } from './notice-entries'
import { createShellEndingFilter } from './shell-ending-filter'
import { attachmentsOf } from './tool-attachments'
import { toolRuns, type ToolRun } from './tool-runs'
import { EAuthor, EEntryKind, toolsRanEntry, type TranscriptEntry } from './transcript-model'
import { turnEndedEntry, turnsBySeq } from './turn-rows'
import type { TurnSpend } from './turn-spend'

const NOTHING_PICTURED: readonly SaidImage[] = Object.freeze([])

export function durableEntries(args: {
  events: readonly Event[]
  turns?: readonly TurnSpend[] | undefined
}): TranscriptEntry[] {
  const events = args.events.filter((event) => !isNoticeArrival(event))
  const opened = new Map<string, ToolRun>(toolRuns(events).map((run) => [run.openedBy, run]))
  const steers = saidWhileToolsWereOutstanding(events)
  const { attached, folded } = contextLoadedWith(events)
  const currentContext = new Set(currentContextEvents(events).map((event) => event.id))
  const pinnedToCalls = new Set(
    [...attachmentsOf(events).values()].flatMap((attachments) =>
      attachments.map((attachment) => attachment.id),
    ),
  )
  const contextByAnchor = contextRuns({
    events,
    isHidden: (id) => folded.has(id) || pinnedToCalls.has(id),
    current: currentContext,
  })
  const turns = turnsBySeq({ events, turns: args.turns ?? [] })
  const footers = new Map(latestTldrPerAnchor(events).map((footer) => [footer.throughSeq, footer]))

  const shellFilter = createShellEndingFilter()

  const entriesOfEvent = (event: Event): TranscriptEntry[] => {
    if (event.type === 'user-said') {
      return [
        {
          kind: EEntryKind.OperatorSaid,
          author: EAuthor.Operator,
          key: event.id,
          text: event.text,
          said: [event.text],
          steer: steers.has(event.id),
          skills: (attached.get(event.id) ?? NOTHING_ATTACHED).skills,
          files: (attached.get(event.id) ?? NOTHING_ATTACHED).files,
          images: event.images ?? NOTHING_PICTURED,
        },
      ]
    }

    if (event.type === 'assistant-said') return entriesOfAssistantEvent(event)

    if (event.type === 'context-loaded') {
      const run = contextByAnchor.get(event.id)
      return run === undefined ? [] : [run]
    }

    if (event.type === 'nudge') {
      return [
        {
          kind: EEntryKind.SystemNotice,
          author: EAuthor.Model,
          key: event.id,
          text: 'nudge',
          content: event.text,
        },
      ]
    }

    if (event.type === 'tool-called') {
      const run = opened.get(event.callId)
      return run === undefined ? [] : [toolsRanEntry(run)]
    }

    const notice = noticeEntriesOf({ event, shellFilter })
    if (notice !== null) return notice

    if (event.type === 'history-compacted') {
      return [
        {
          kind: EEntryKind.HistoryCompacted,
          author: EAuthor.Model,
          key: event.id,
          text: event.summary,
          compactedEntries: event.replaced,
        },
      ]
    }

    if (event.type === 'location-changed') {
      if (isRelocationMarker(event)) return []
      return [locationChangedEntry({ key: event.id, to: event.to, cause: event.cause })]
    }

    return []
  }

  const flat = (): TranscriptEntry[] =>
    events.flatMap((event): TranscriptEntry[] => {
      shellFilter.noteToolResult(event)
      const entries = entriesOfEvent(event)
      const footer = footers.get(event.seq)
      const withFooter =
        footer === undefined
          ? entries
          : [
              ...entries,
              {
                kind: EEntryKind.TldrWritten as const,
                author: EAuthor.Model as const,
                key: footer.id,
                text: footer.text,
                anchorSeq: footer.anchorSeq,
                throughSeq: footer.throughSeq,
                status: footer.status,
              },
            ]
      const turn = turns.get(event.seq)
      return turn === undefined ? withFooter : [...withFooter, turnEndedEntry(turn)]
    })

  return inOneBreath(flat())
}
