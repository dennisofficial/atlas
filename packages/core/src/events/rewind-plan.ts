import type { EventDraft, EventType } from './body'
import type { Event, EventOfType } from './envelope'
import type { CallId, RunId, ThreadId } from './ids'

export type ShellNoticeType = Extract<EventType, `background-shell-${string}`>

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

const isShellNotice = (event: Event): event is EventOfType<ShellNoticeType> =>
  event.type.startsWith('background-shell-')

const isNotice = (event: Event): boolean =>
  isShellNotice(event) ||
  event.type === 'service-ended' ||
  event.type === 'agent-ended' ||
  event.type === 'location-changed'

const recordOf = (input: unknown): Record<string, unknown> | undefined =>
  typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : undefined

const stringOf = (record: Record<string, unknown> | undefined, key: string): string | undefined => {
  const value = record?.[key]
  return typeof value === 'string' ? value : undefined
}

const runsInBackground = (input: unknown): boolean => recordOf(input)?.runInBackground === true

const isServiceStart = (event: Event): boolean =>
  event.type === 'tool-called' && event.name === 'service_start'

type StartDetails = { command: string | undefined; description: string | undefined }

const startDetailsOf = (input: unknown): StartDetails => ({
  command: stringOf(recordOf(input), 'command'),
  description: stringOf(recordOf(input), 'description'),
})

const toNotice = (event: Event): RewoundNotice => {
  const { id, seq, threadId, runId, parentRunId, depth, at, ...draft } = event
  return { runId, draft }
}

/**
 * A rewind owns only what it removes: a creation is cut when its start sits above the cut, and a
 * start the log no longer holds — summarised away, or inherited — means keep. That is also why a
 * shell_output read above the cut condemns nothing: only a runInBackground call paired with the
 * result carrying the shellId is a start, and only a service_start call paired with the result
 * carrying the serviceId is a service creation.
 *
 * Notices above the cut survive exactly when their source survives: they are re-appended above
 * the new head rather than deleted with the rows around them.
 */
export function rewindPlan({
  events,
  toSeq,
}: {
  events: readonly Event[]
  toSeq: number
}): RewindPlan {
  const above = events.filter((event) => event.seq > toSeq)

  const cuts: RewindCut[] = []
  const cutAgentIds = new Set<ThreadId>()
  for (const event of above) {
    if (event.type !== 'agent-spawned' && event.type !== 'agent-restarted') continue
    cutAgentIds.add(event.agentId)
    cuts.push({
      kind: 'agent',
      seq: event.seq,
      agentId: event.agentId,
      agentType: event.agentType,
      intent: event.intent,
    })
  }

  const shellStarts = new Map<CallId, StartDetails>()
  const serviceStarts = new Map<CallId, StartDetails>()
  for (const event of above) {
    if (event.type !== 'tool-called') continue
    if (runsInBackground(event.input)) shellStarts.set(event.callId, startDetailsOf(event.input))
    if (isServiceStart(event)) serviceStarts.set(event.callId, startDetailsOf(event.input))
  }

  const cutShellIds = new Set<string>()
  const cutServiceIds = new Set<string>()
  for (const event of above) {
    if (event.type !== 'tool-result') continue
    const output = recordOf(event.output)

    const shellStart = shellStarts.get(event.callId)
    const shellId = shellStart === undefined ? undefined : stringOf(output, 'shellId')
    if (shellStart !== undefined && shellId !== undefined) {
      cutShellIds.add(shellId)
      cuts.push({ kind: 'shell', seq: event.seq, shellId, ...shellStart })
    }

    const serviceStart = serviceStarts.get(event.callId)
    const serviceId = serviceStart === undefined ? undefined : stringOf(output, 'serviceId')
    if (serviceStart !== undefined && serviceId !== undefined) {
      cutServiceIds.add(serviceId)
      cuts.push({ kind: 'service', seq: event.seq, serviceId, ...serviceStart })
    }
  }

  const survives = (event: Event): boolean => {
    if (event.type === 'location-changed') return true
    if (isShellNotice(event)) return !cutShellIds.has(event.shellId)
    if (event.type === 'service-ended') return !cutServiceIds.has(event.serviceId)
    if (event.type === 'agent-ended') return !cutAgentIds.has(event.agentId)
    return false
  }

  const reappend = above.filter((event) => isNotice(event) && survives(event)).map(toNotice)

  cuts.sort((a, b) => a.seq - b.seq)
  return { cuts, reappend }
}
