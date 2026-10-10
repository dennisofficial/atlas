import { EAssistantPlaceholder, EContextSlot, EExecutionLocation, EKilledBy, EOperatorInputOutcome, currentContextEvents, latestTldrPerAnchor, quotedShellCommand, type AssistantPart, type CallId, type Event, type EventId, type EventOfType, type ELocationChangeCause, type SaidImage } from '@dltech/atlas-core'

import { formatElapsed } from '../ui/theme'


import {
  agentEndedLine,
  agentEndingFailed,
  agentReportedLine,
  agentRestartedLine,
} from './agent-ended-line'
import { deliberateAgentRestart } from './notice-barriers'
import { modelEntries } from './model-entries'
import { prEventFailed, prEventLine } from './pr-event-line'
import { serviceEndedLine, serviceEndingFailed } from './service-ended-line'
import { shellAwaitingInputLine, shellEndedLine, shellEndingFailed } from './shell-ended-line'
import { attachmentsOf, toolRuns, type ToolRun } from './tool-runs'
import type { TurnSpend } from '@dltech/atlas-harness'
import {
  EAuthor,
  EEntryKind,
  toolsRanEntry,
  type SystemContextEntry,
  type SystemContextItem,
  type TranscriptEntry,
} from './transcript-model'
import { turnEndedEntry, turnsBySeq } from './turn-rows'

const shellName = (shell: { command: string; description?: string | undefined }): string => {
  const description = shell.description?.trim() ?? ''
  return description === '' ? quotedShellCommand(shell.command) : `"${description}"`
}

const matchedLineCount = (count: number): string => (count === 1 ? '1 line' : `${count} lines`)

const shellMatchedLine = (event: EventOfType<'background-shell-matched'>): string => {
  const named = shellName(event)
  const matched = `matched ${matchedLineCount(event.matchCount)}`
  return event.watchDisarmed === true
    ? `Background shell ${named} ${matched}, but stopped watching`
    : `Background shell ${named} ${matched}`
}

const shellStillRunningEntryLine = (
  event: EventOfType<'background-shell-still-running'>,
): string =>
  `Background shell ${shellName(event)} is still running after ${formatElapsed(event.runningForMs)} - a scheduled check-in, not an ending`

type PartRun = { type: AssistantPart['type']; text: string }

function runsOfParts(parts: readonly AssistantPart[]): PartRun[] {
  const runs: PartRun[] = []

  for (const part of parts) {
    const open = runs.at(-1)
    if (open?.type === part.type) {
      open.text += part.text
      continue
    }

    runs.push({ type: part.type, text: part.text })
  }

  return runs
}

function entriesOfAssistantEvent(event: EventOfType<'assistant-said'>): TranscriptEntry[] {
  const muted = event.placeholder === EAssistantPlaceholder.NoContent
  return modelEntries({
    runs: runsOfParts(event.parts).map((run, index) => ({
      key: `${event.id}#${index}`,
      text: run.text,
      isReasoning: run.type === 'reasoning',
      muted,
    })),
    streaming: false,
    interruptedAtEnd: event.interrupted === true,
  })
}

function saidWhileToolsWereOutstanding(events: readonly Event[]): ReadonlySet<EventId> {
  const outstanding = new Set<CallId>()
  const steers = new Set<EventId>()

  for (const event of events) {
    if (event.type === 'tool-called') outstanding.add(event.callId)
    if (event.type === 'tool-result' || event.type === 'tool-denied') {
      outstanding.delete(event.callId)
    }
    if (event.type === 'user-said' && outstanding.size > 0) steers.add(event.id)
  }

  return steers
}

type AttachedContext = { skills: readonly string[]; files: readonly string[] }

const NOTHING_ATTACHED: AttachedContext = { skills: [], files: [] }

function contextLoadedWith(events: readonly Event[]): {
  attached: ReadonlyMap<EventId, AttachedContext>
  folded: ReadonlySet<EventId>
} {
  const attached = new Map<EventId, AttachedContext>()
  const folded = new Set<EventId>()
  let skills: string[] = []
  let files: string[] = []
  let pending: EventId[] = []

  for (const event of events) {
    if (event.type === 'context-loaded') {
      if (event.slot === EContextSlot.Skill) skills.push(event.key)
      if (event.slot === EContextSlot.File) files.push(event.key)
      pending.push(event.id)
      continue
    }

    if (event.type === 'user-said' && skills.length + files.length > 0) {
      attached.set(event.id, { skills, files })
      for (const id of pending) folded.add(id)
    }
    skills = []
    files = []
    pending = []
  }

  return { attached, folded }
}

const NOTHING_PICTURED: readonly SaidImage[] = Object.freeze([])

const FOLDED_ELSEWHERE_SLOTS: ReadonlySet<string> = new Set([EContextSlot.Skill, EContextSlot.File])

const KNOWN_SLOT_LABELS: ReadonlyMap<string, string> = new Map([
  [EContextSlot.UserInstructions, 'global instructions'],
  [EContextSlot.ProjectInstructions, 'project instructions'],
  [EContextSlot.NestedInstructions, 'directory instructions'],
  [EContextSlot.SkillListing, 'skill listing'],
  [EContextSlot.McpInstructions, 'MCP server instructions'],
])

const SKILL_SUGGESTION_NAME = /skill classifier picked '([a-z0-9-]+)' as relevant/

const memoryLabelOf = (key: string): string => {
  const segments = key.split('/').filter((segment) => segment.length > 0)
  const memory = segments.lastIndexOf('memory')
  if (memory < 0) return 'memory'
  if (segments[memory - 1] === '.atlas') return 'global memory'
  return segments.slice(0, memory).includes('projects') ? 'project memory' : 'memory'
}

const slotLabelOf = (event: EventOfType<'context-loaded'>): string => {
  const label = KNOWN_SLOT_LABELS.get(event.slot)
  if (label !== undefined) return label
  if (event.slot === EContextSlot.Memory) return memoryLabelOf(event.key)
  if (event.slot === 'skill-suggestion') {
    const name = SKILL_SUGGESTION_NAME.exec(event.content)?.[1]
    return name === undefined ? 'skill suggestion' : `skill suggestion · ${name}`
  }
  if (event.slot === 'plan') return 'plan mirror'
  if (event.slot === 'outside-project') return 'outside-project warning'
  if (event.slot === 'pr-transitions') return 'pull-request updates'
  if (event.slot === 'session') return 'session relocation'
  return event.slot.replaceAll('-', ' ')
}

const injectionsSummary = (items: readonly SystemContextItem[]): string =>
  items.length === 1 ? (items[0]?.label ?? '') : `${items.length} prompts`

function contextRuns(args: {
  events: readonly Event[]
  isHidden: (id: EventId) => boolean
  current: ReadonlySet<EventId>
}): ReadonlyMap<EventId, SystemContextEntry> {
  const runs = new Map<EventId, SystemContextEntry>()
  let open: { anchor: EventId; items: SystemContextItem[] } | undefined

  const close = (): void => {
    if (open === undefined) return
    runs.set(open.anchor, {
      kind: EEntryKind.SystemContext,
      author: EAuthor.Model,
      key: open.anchor,
      text: injectionsSummary(open.items),
      items: open.items,
    })
    open = undefined
  }

  for (const event of args.events) {
    if (event.type !== 'context-loaded') {
      close()
      continue
    }
    if (args.isHidden(event.id)) continue

    const item: SystemContextItem = {
      key: event.id,
      label: slotLabelOf(event),
      content: event.content,
      superseded: !args.current.has(event.id),
    }
    if (open === undefined) open = { anchor: event.id, items: [item] }
    else open.items.push(item)
  }
  close()

  return runs
}

function inOneBreath(entries: readonly TranscriptEntry[]): TranscriptEntry[] {
  const folded: TranscriptEntry[] = []

  for (const entry of entries) {
    const open = folded.at(-1)
    if (
      entry.kind !== EEntryKind.OperatorSaid ||
      open?.kind !== EEntryKind.OperatorSaid ||
      open.steer !== entry.steer
    ) {
      folded.push(entry)
      continue
    }

    folded[folded.length - 1] = {
      ...open,
      text: `${open.text}\n${entry.text}`,
      said: [...open.said, ...entry.said],
      skills: [...new Set([...open.skills, ...entry.skills])],
      files: [...new Set([...open.files, ...entry.files])],
      images: [...open.images, ...entry.images],
    }
  }

  return folded
}

const locationChangedEntry = (args: {
  key: string
  to: EExecutionLocation
  cause?: ELocationChangeCause | undefined
}): TranscriptEntry => {
  const text =
    args.to === EExecutionLocation.Docker
      ? 'docker container'
      : args.to === EExecutionLocation.Cloud
        ? 'cloud sandbox'
        : 'host'
  return {
    kind: EEntryKind.LocationChanged,
    author: EAuthor.Model,
    key: args.key,
    text,
    to: args.to,
    cause: args.cause,
  }
}

export function durableEntries(args: {
  events: readonly Event[]
  turns?: readonly TurnSpend[] | undefined
}): TranscriptEntry[] {
  const { events } = args
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

  /**
   * Teardown once re-recorded an ending for every shell a turn had already settled, appending a
   * second background-shell-ended behind the real one with killedBy session-end and empty output.
   * Those duplicate events sit in the log permanently, so the transcript drops a session-end ending
   * that follows a clean ending for the same shell and command — keyed on the command too, because
   * a shell id is reused across restarts and a fresh shell under it must still announce. Only a
   * session-end ending after a clean one is dropped: a shell_kill or a second clean exit is a
   * deliberate telling and stays, and a session-end ending that follows only another session-end
   * (a shell genuinely killed at close under a recycled id) stays too, because no clean ending
   * ever settled it.
   */
  const settledShells = new Set<string>()
  const isRedundantTeardownEnding = (event: EventOfType<'background-shell-ended'>): boolean => {
    if (event.killedBy !== EKilledBy.SessionEnd) return false
    const key = `${event.shellId}${event.command}`
    return settledShells.has(key)
  }
  const noteShellEnding = (event: EventOfType<'background-shell-ended'>): void => {
    if (event.killedBy === EKilledBy.SessionEnd) return
    settledShells.add(`${event.shellId}${event.command}`)
  }

  /**
   * The same teardown also re-recorded shells the model had already killed through shell_kill:
   * that ending was delivered as the tool result, so no standalone event was meant to exist, and
   * the synthesized one carries empty output. Those sit in old logs permanently, so the transcript
   * drops a model-kill ending with no output when a shell_kill tool result for the same shell and
   * command is already present. Keyed on the command too, because a shell id recycles across
   * restarts and an old kill must not hide a fresh shell's genuinely silent ending. An ending with
   * real output is always kept — output means it was the telling, never a synthesized dupe.
   */
  const shellKillResults = new Set<string>()
  const noteToolResult = (event: Event): void => {
    if (event.type !== 'tool-result' || event.name !== 'shell_kill') return
    const output = event.output
    if (typeof output !== 'object' || output === null) return
    const record = output as { shellId?: unknown; command?: unknown }
    if (typeof record.shellId !== 'string') return
    shellKillResults.add(`${record.shellId}${typeof record.command === 'string' ? record.command : ''}`)
  }
  const isRedundantClaimedEnding = (event: EventOfType<'background-shell-ended'>): boolean =>
    event.killedBy === EKilledBy.Model &&
    event.output === '' &&
    shellKillResults.has(`${event.shellId}${event.command}`)

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

    if (event.type === 'background-shell-ended') {
      if (isRedundantTeardownEnding(event)) return []
      if (isRedundantClaimedEnding(event)) return []
      noteShellEnding(event)
      return [
        {
          kind: EEntryKind.BackgroundShellEnded,
          author: EAuthor.Model,
          key: event.id,
          text: shellEndedLine(event),
          shellId: event.shellId,
          output: event.output,
          failed: shellEndingFailed(event),
        },
      ]
    }

    if (event.type === 'background-shell-awaiting-input') {
      return [
        {
          kind: EEntryKind.BackgroundShellAwaitingInput,
          author: EAuthor.Model,
          key: event.id,
          text: shellAwaitingInputLine(event),
          shellId: event.shellId,
          output: event.output,
        },
      ]
    }

    if (event.type === 'background-shell-matched') {
      return [
        {
          kind: EEntryKind.BackgroundShellMatched,
          author: EAuthor.Model,
          key: event.id,
          text: shellMatchedLine(event),
          shellId: event.shellId,
          output: event.lines,
        },
      ]
    }

    if (event.type === 'background-shell-still-running') {
      return [
        {
          kind: EEntryKind.BackgroundShellStillRunning,
          author: EAuthor.Model,
          key: event.id,
          text: shellStillRunningEntryLine(event),
          shellId: event.shellId,
          output: event.tail,
        },
      ]
    }

    if (event.type === 'service-ended') {
      return [
        {
          kind: EEntryKind.ServiceEnded,
          author: EAuthor.Model,
          key: event.id,
          text: serviceEndedLine(event),
          serviceId: event.serviceId,
          output: event.tail,
          failed: serviceEndingFailed(event),
        },
      ]
    }

    if (event.type === 'agent-ended') {
      return [
        {
          kind: EEntryKind.AgentEnded,
          author: EAuthor.Model,
          key: event.id,
          text: agentEndedLine(event),
          agentId: event.agentId,
          report: event.prose,
          failed: agentEndingFailed(event),
        },
      ]
    }

    if (event.type === 'agent-reported') {
      return [
        {
          kind: EEntryKind.AgentReported,
          author: EAuthor.Model,
          key: event.id,
          text: agentReportedLine(event),
          agentId: event.agentId,
          report: event.prose,
        },
      ]
    }

    if (event.type === 'pr-event') {
      return [
        {
          kind: EEntryKind.PrEvent,
          author: EAuthor.Model,
          key: event.id,
          text: prEventLine(event),
          body: event.body ?? '',
          failed: prEventFailed(event),
        },
      ]
    }

    if (event.type === 'agent-restarted') {
      if (!deliberateAgentRestart(event)) return []
      return [
        {
          kind: EEntryKind.AgentRestarted,
          author: EAuthor.Model,
          key: event.id,
          text: agentRestartedLine(event),
          agentId: event.agentId,
        },
      ]
    }

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
      return [locationChangedEntry({ key: event.id, to: event.to, cause: event.cause })]
    }

    if (event.type === 'rotated') {
      return [
        {
          kind: EEntryKind.Rotated,
          author: EAuthor.Model,
          key: event.id,
          text: `rotated from ${event.predecessor}`,
          predecessor: event.predecessor,
          handoffPath: event.handoffPath,
        },
      ]
    }

    if (event.type === 'operator-input-requested') {
      return [
        {
          kind: EEntryKind.OperatorInput,
          author: EAuthor.Model,
          key: event.id,
          text: `asks the operator: ${event.description}`,
        },
      ]
    }

    if (event.type === 'operator-input-resolved') {
      const text =
        event.outcome === EOperatorInputOutcome.Delivered
          ? `the operator's pasted value was delivered (${event.bytes ?? 0} bytes)`
          : event.outcome === EOperatorInputOutcome.Undelivered
            ? 'the operator input could not be delivered'
            : 'the operator input request was cancelled'
      return [
        {
          kind: EEntryKind.OperatorInput,
          author: EAuthor.Model,
          key: event.id,
          text,
        },
      ]
    }

    return []
  }

  const flat = (): TranscriptEntry[] =>
    events.flatMap((event): TranscriptEntry[] => {
      noteToolResult(event)
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
