import type { EventType } from './body'
import type { Event, EventOfType } from './envelope'
import type { CallId, EventId } from './ids'

export type ShellNoticeType = Extract<EventType, `background-shell-${string}`>

export type ShellNotice = EventOfType<Exclude<ShellNoticeType, 'background-shell-started'>>

export type StartDetails = { command: string | undefined; description: string | undefined }

export type ShellOccurrence = StartDetails & {
  startId: EventId
  seq: number
  cutSeq: number
  shellId: string
  bootId: string | undefined
}

type LegacyLaunch = StartDetails & {
  startId: EventId
  callSeq: number
  resultSeq: number
  shellId: string
}

export const recordOf = (input: unknown): Record<string, unknown> | undefined =>
  typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : undefined

export const stringOf = (record: Record<string, unknown> | undefined, key: string): string | undefined => {
  const value = record?.[key]
  return typeof value === 'string' ? value : undefined
}

export const startDetailsOf = (input: unknown): StartDetails => ({
  command: stringOf(recordOf(input), 'command'),
  description: stringOf(recordOf(input), 'description'),
})

export const isShellNotice = (event: Event): event is ShellNotice =>
  event.type.startsWith('background-shell-') && event.type !== 'background-shell-started'

const runsInBackground = (input: unknown): boolean => recordOf(input)?.runInBackground === true

const legacyLaunchesOf = (events: readonly Event[]): LegacyLaunch[] => {
  const calls = new Map<CallId, EventOfType<'tool-called'>>()
  const launches: LegacyLaunch[] = []
  for (const event of events) {
    if (event.type === 'tool-called' && event.name === 'bash' && runsInBackground(event.input)) calls.set(event.callId, event)
    if (event.type !== 'tool-result') continue
    const call = calls.get(event.callId)
    const shellId = stringOf(recordOf(event.output), 'shellId')
    if (call === undefined || shellId === undefined) continue
    launches.push({
      ...startDetailsOf(call.input),
      startId: call.id,
      callSeq: call.seq,
      resultSeq: event.seq,
      shellId,
    })
  }
  return launches
}

export function shellOccurrences(events: readonly Event[]): ShellOccurrence[] {
  const starts = events.filter((event): event is EventOfType<'background-shell-started'> =>
    event.type === 'background-shell-started',
  )
  const launches = legacyLaunchesOf(events)
  const claimed = new Set<EventId>()

  const unpaired = launches.filter((launch) => {
    const nextCallSeq = launches
      .filter((other) => other.shellId === launch.shellId && other.callSeq > launch.callSeq)
      .reduce((least, other) => Math.min(least, other.callSeq), Number.POSITIVE_INFINITY)
    const start = starts.find(
      (candidate) =>
        candidate.shellId === launch.shellId &&
        !claimed.has(candidate.id) &&
        candidate.seq > launch.callSeq &&
        candidate.seq < nextCallSeq,
    )
    if (start === undefined) return true
    claimed.add(start.id)
    return false
  })

  const modern = starts.map((start): ShellOccurrence => ({
    startId: start.id,
    seq: start.seq,
    cutSeq: start.seq,
    shellId: start.shellId,
    bootId: start.bootId,
    command: start.command,
    description: start.description,
  }))
  const legacy = unpaired.map((launch): ShellOccurrence => ({
    startId: launch.startId,
    seq: launch.callSeq,
    cutSeq: launch.resultSeq,
    shellId: launch.shellId,
    bootId: undefined,
    command: launch.command,
    description: launch.description,
  }))
  return [...modern, ...legacy].sort((a, b) => a.seq - b.seq)
}

export function occurrenceOfNotice({
  occurrences,
  notice,
}: {
  occurrences: readonly ShellOccurrence[]
  notice: ShellNotice
}): ShellOccurrence | undefined {
  const earlier = occurrences.filter(
    (occurrence) => occurrence.shellId === notice.shellId && occurrence.seq < notice.seq,
  )
  const bootId = 'bootId' in notice ? notice.bootId : undefined
  if (bootId === undefined) return earlier[earlier.length - 1]
  const sameBoot = earlier.filter((occurrence) => occurrence.bootId === bootId)
  if (sameBoot.length > 0) return sameBoot[sameBoot.length - 1]
  const unbooted = earlier.filter((occurrence) => occurrence.bootId === undefined)
  return unbooted[unbooted.length - 1]
}
