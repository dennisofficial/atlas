import {
  EOperatorInputOutcome,
  modelFallbackCopy,
  prEventContent,
  runEventContent,
  serviceFailed,
  reachesModel,
  type Event,
} from '@dltech/atlas-core'

import { agentEndedLine, agentEndingFailed, agentReportedLine } from './agent-ended-line'
import { prEventFailed, prEventLine } from './pr-event-line'
import { serviceEndedLine } from './service-ended-line'
import { shellAwaitingInputLine, shellEndedLine, shellEndingFailed } from './shell-ended-line'
import { shellMatchedLine, shellStillRunningEntryLine } from './shell-lines'
import { EAuthor, EEntryKind, type TranscriptEntry } from './transcript-model'

export function noticeEntriesOf(event: Event): TranscriptEntry[] | null {
  if (event.type === 'background-shell-ended') {
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
    if (!reachesModel(event)) return []
    return [
      {
        kind: EEntryKind.ServiceEnded,
        author: EAuthor.Model,
        key: event.id,
        text: serviceEndedLine(event),
        serviceId: event.serviceId,
        output: event.tail,
        failed: serviceFailed(event),
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
        body: prEventContent(event),
        failed: prEventFailed(event),
        repo: event.repo,
        prNumber: event.prNumber,
      },
    ]
  }

  if (event.type === 'run-event') {
    return [
      {
        kind: EEntryKind.SystemNotice,
        author: EAuthor.Model,
        key: event.id,
        text: `${event.workflow} #${event.workflowRunId} ${event.conclusion}`,
        content: runEventContent(event),
      },
    ]
  }

  if (event.type === 'model-fell-back') {
    const copy = modelFallbackCopy(event)
    return [
      {
        kind: EEntryKind.ModelFellBack,
        author: EAuthor.Model,
        key: event.id,
        text: copy.title,
        content: copy.detail,
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

  if (event.type === 'agent-restarted') return []

  if (event.type === 'rotated') {
    const text =
      event.auto === undefined
        ? 'context rotated here'
        : `rotated automatically at ${event.auto.percent}% of the window`
    return [
      {
        kind: EEntryKind.Rotated,
        author: EAuthor.Model,
        key: event.id,
        text,
        handoff: event.handoff,
        ...(event.instructions === undefined ? {} : { instructions: event.instructions }),
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
