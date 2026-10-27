import { EOperatorInputOutcome, type Event } from '@dltech/atlas-core'

import {
  agentEndedLine,
  agentEndingFailed,
  agentReportedKindLine,
  agentRestartedLine,
} from './agent-ended-line'
import { deliberateAgentRestart } from './notice-barriers'
import { prEventFailed, prEventLine } from './pr-event-line'
import { serviceEndedLine, serviceEndingFailed } from './service-ended-line'
import { shellAwaitingInputLine, shellEndedLine, shellEndingFailed } from './shell-ended-line'
import { shellMatchedLine, shellStillRunningEntryLine } from './shell-lines'
import type { ShellEndingFilter } from './shell-ending-filter'
import { EAuthor, EEntryKind, type TranscriptEntry } from './transcript-model'

export function noticeEntriesOf(args: {
  event: Event
  shellFilter: ShellEndingFilter
}): TranscriptEntry[] | null {
  const { event, shellFilter } = args

  if (event.type === 'background-shell-ended') {
    if (shellFilter.isRedundantEnding(event)) return []
    shellFilter.noteShellEnding(event)
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
    if (event.relayed === false) return []

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
        text: agentReportedKindLine(event),
        agentId: event.agentId,
        report: event.prose,
        reportKind: event.kind,
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

  return null
}
