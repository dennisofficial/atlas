import type { EventDraft } from './body'
import type { Event } from './envelope'
import type { CallId, RunId, ThreadId } from './ids'
import { isNoticeDelivery, noticeIdOf } from './notice-stage'
import {
  ERewindDisposition,
  isCreatorBound,
  rewindDisposition,
  type CreatorBoundEvent,
} from './rewind-disposition'
import {
  occurrenceOfNotice,
  recordOf,
  shellOccurrences,
  startDetailsOf,
  stringOf,
  type StartDetails,
} from './rewind-shell-occurrences'

export type { ShellNoticeType } from './rewind-shell-occurrences'

export type RewindCut =
  | {
      kind: 'agent'
      seq: number
      agentId: ThreadId
      agentType: string
      intent: string
    }
  | {
      kind: 'shell'
      seq: number
      shellId: string
      command: string | undefined
      description: string | undefined
    }
  | {
      kind: 'service'
      seq: number
      serviceId: string
      command: string | undefined
      description: string | undefined
    }

export type RewoundNotice = {
  runId: RunId
  draft: EventDraft
}

export type RewindPlan = {
  cuts: readonly RewindCut[]
  reappend: readonly RewoundNotice[]
}

const isServiceStart = (event: Event): boolean =>
  event.type === 'tool-called' && event.name === 'service_start'

const toNotice = (event: Event): RewoundNotice => {
  const { id, seq, threadId, runId, parentRunId, depth, at, ...draft } = event
  return { runId, draft }
}

export function rewindPlan({
  events,
  toSeq,
}: {
  events: readonly Event[]
  toSeq: number
}): RewindPlan {
  const above = events.filter((event) => event.seq > toSeq)
  const occurrences = shellOccurrences(events)

  const cuts: RewindCut[] = []
  const cutAgentIds = new Set<ThreadId>()
  for (const event of above) {
    if (event.type === 'agent-spawned' || event.type === 'agent-restarted') {
      cutAgentIds.add(event.agentId)
      cuts.push({
        kind: 'agent',
        seq: event.seq,
        agentId: event.agentId,
        agentType: event.agentType,
        intent: event.intent,
      })
    }
  }

  for (const occurrence of occurrences) {
    if (occurrence.seq <= toSeq) continue
    cuts.push({
      kind: 'shell',
      seq: occurrence.cutSeq,
      shellId: occurrence.shellId,
      command: occurrence.command,
      description: occurrence.description,
    })
  }

  const serviceStarts = new Map<CallId, StartDetails>()
  for (const event of above) {
    if (event.type === 'tool-called' && isServiceStart(event)) {
      serviceStarts.set(event.callId, startDetailsOf(event.input))
    }
  }

  const cutServiceIds = new Set<string>()
  for (const event of above) {
    if (event.type !== 'tool-result') continue
    const output = recordOf(event.output)

    const serviceStart = serviceStarts.get(event.callId)
    const serviceId = serviceStart === undefined ? undefined : stringOf(output, 'serviceId')
    if (serviceStart !== undefined && serviceId !== undefined) {
      cutServiceIds.add(serviceId)
      cuts.push({ kind: 'service', seq: event.seq, serviceId, ...serviceStart })
    }
  }

  const creatorCut = (event: CreatorBoundEvent): boolean => {
    switch (event.type) {
      case 'agent-ended':
        return cutAgentIds.has(event.agentId)
      case 'service-ended':
        return cutServiceIds.has(event.serviceId)
      case 'background-shell-ended':
      case 'background-shell-awaiting-input':
      case 'background-shell-matched':
      case 'background-shell-still-running': {
        const occurrence = occurrenceOfNotice({ occurrences, notice: event })
        return occurrence !== undefined && occurrence.seq > toSeq
      }
      default:
        return assertNever(event)
    }
  }

  const arrivals = new Map<string, Event>()
  for (const event of events) {
    const noticeId = noticeIdOf(event)
    if (noticeId !== undefined && !isNoticeDelivery(event)) arrivals.set(noticeId, event)
  }

  const creatorEvent = (event: CreatorBoundEvent): CreatorBoundEvent => {
    const noticeId = noticeIdOf(event)
    if (noticeId === undefined || !isNoticeDelivery(event)) return event
    const twin = arrivals.get(noticeId)
    return twin !== undefined && isCreatorBound(twin) ? twin : event
  }

  const survives = (event: Event): boolean => {
    switch (rewindDisposition(event.type)) {
      case ERewindDisposition.Discard:
        return false
      case ERewindDisposition.Keep:
        return true
      case ERewindDisposition.KeepUnlessCreatorCut:
        return isCreatorBound(event) && !creatorCut(creatorEvent(event))
    }
  }

  const reappend = above.filter(survives).map(toNotice)

  cuts.sort((a, b) => a.seq - b.seq)
  return { cuts, reappend }
}

const assertNever = (value: never): never => {
  throw new Error(`unhandled creator-bound event: ${JSON.stringify(value)}`)
}
