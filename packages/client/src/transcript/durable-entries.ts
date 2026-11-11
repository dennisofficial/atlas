import {
  attachmentsOf as attachmentsOfSaid,
  currentContextEvents,
  EKilledBy,
  EMessageOrigin,
  isNoticeArrival,
  laneNameOf,
  latestTldrPerAnchor,
  saidBy,
  type Event,
} from '@dltech/atlas-core'

import { entriesOfAssistantEvent, saidWhileToolsWereOutstanding } from './assistant-entries'
import { contextLoadedWith, contextRuns, NOTHING_ATTACHED } from './context-entries'
import { inOneBreath } from './entry-folds'
import type { TranscriptEntryFold } from './entry-builders'
import { noticeEntriesOf } from './notice-entries'
import { attachmentsOf } from './tool-attachments'
import { toolRuns, type ToolRun } from './tool-runs'
import { EAuthor, EEntryKind, toolsRanEntry, type TranscriptEntry } from './transcript-model'
import { turnEndedEntry, turnsBySeq } from './turn-rows'
import type { TurnSpend } from './turn-spend'

const agentSenderOf = (event: Event & { type: 'user-said' }): string =>
  laneNameOf({ origin: saidBy(event), sender: event.sender?.session }).phrase

export function durableEntries(args: {
  events: readonly Event[]
  turns?: readonly TurnSpend[] | undefined
  pluginEntries?: readonly TranscriptEntryFold[] | undefined
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
  const pluginRows = new Map<string, TranscriptEntry>()
  for (const fold of args.pluginEntries ?? []) {
    for (const [id, entry] of fold(events)) pluginRows.set(id, entry)
  }
  const footers = new Map(latestTldrPerAnchor(events).map((footer) => [footer.throughSeq, footer]))

  const shellKey = (args: { shellId: string; command: string }): string =>
    `${args.shellId}${args.command}`

  /**
   * Teardown once re-recorded an ending for every shell a turn had already settled, appending a
   * second background-shell-ended behind the real one with killedBy session-end and empty output.
   * Those duplicates sit in old logs permanently, so a session-end ending that follows a clean
   * ending for the same shell and command is dropped — keyed on the command too, because a shell id
   * is reused across restarts and a fresh shell under it must still announce.
   */
  const settledShells = new Set<string>()

  /**
   * The same teardown re-recorded shells the model had already killed through shell_kill, whose
   * ending was delivered as the tool result: the synthesized copy carries no output. An ending with
   * real output is always kept, because output means it was the telling rather than a dupe.
   */
  const claimedShells = new Set<string>()

  const isRedundantEnding = (event: Event & { type: 'background-shell-ended' }): boolean => {
    const key = shellKey(event)
    if (event.killedBy === EKilledBy.SessionEnd) return settledShells.has(key)
    return event.killedBy === EKilledBy.Model && event.output === '' && claimedShells.has(key)
  }

  const noteShellKill = (event: Event): void => {
    if (event.type !== 'tool-result' || event.name !== 'shell_kill') return
    const output = event.output
    if (typeof output !== 'object' || output === null) return
    const record: { shellId?: unknown; command?: unknown } = output
    if (typeof record.shellId !== 'string') return
    claimedShells.add(
      shellKey({
        shellId: record.shellId,
        command: typeof record.command === 'string' ? record.command : '',
      }),
    )
  }

  const entriesOfEvent = (event: Event): TranscriptEntry[] => {
    noteShellKill(event)

    if (event.type === 'background-shell-ended') {
      if (isRedundantEnding(event)) return []
      if (event.killedBy !== EKilledBy.SessionEnd) settledShells.add(shellKey(event))
    }

    if (event.type === 'user-said' && saidBy(event) !== EMessageOrigin.Operator) {
      return [
        {
          kind: EEntryKind.AgentSaid,
          author: EAuthor.Model,
          key: event.id,
          text: event.text,
          sender: agentSenderOf(event),
          senderSessionId: event.sender?.session ?? null,
        },
      ]
    }

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
          attachments: attachmentsOfSaid(event),
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

    if (event.type === 'sandbox-setup-reported') {
      return [
        {
          kind: EEntryKind.SandboxNotice,
          author: EAuthor.Model,
          key: event.id,
          text: event.text,
          failed: event.failed,
        },
      ]
    }

    if (event.type === 'tool-called') {
      const run = opened.get(event.callId)
      return run === undefined ? [] : [toolsRanEntry(run)]
    }

    const pluginRow = pluginRows.get(event.id)
    if (pluginRow !== undefined) return [pluginRow]

    const notice = noticeEntriesOf(event)
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

    return []
  }

  const flat = (): TranscriptEntry[] =>
    events.flatMap((event): TranscriptEntry[] => {
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
