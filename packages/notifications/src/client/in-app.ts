import {
  ENotifyMoment,
  ESessionStatus,
  ETurnEndedBy,
  ETurnOutcome,
  type AtlasNotification,
  type TurnNotify,
  inAppDueOf,
  inAppNoticeOf,
  notifyMomentOf,
} from '@dltech/atlas-core'

export type InAppLastTurn = {
  seq: number
  outcome: ETurnOutcome
  by: ETurnEndedBy
  at?: string | undefined
  notify?: TurnNotify | undefined
}

export type InAppRow = {
  sessionId: string
  title: string | null
  status: ESessionStatus | null
  readSeq: number | null
  headSeq: number | null
  nested: boolean
  lastTurn: InAppLastTurn | null
}

export type InAppRowSource = {
  sessionId: string
  title: string | null
  status?: { state: ESessionStatus } | null | undefined
  readSeq?: number | null | undefined
  headSeq?: number | null | undefined
  spawnedBy?: string | null | undefined
  nested?: boolean | null | undefined
  lastTurn?: InAppLastTurn | null | undefined
}

export type InAppMoment = { row: InAppRow; moment: ENotifyMoment; seq: number }

export type HeldNotice = { sessionId: string; seq: number; dueAt: string }

export type InAppScan = { notices: AtlasNotification[]; held: HeldNotice[] }

const WAITING_STATUSES: readonly ESessionStatus[] = [
  ESessionStatus.WaitingForOperator,
  ESessionStatus.WaitingForCredentials,
]

const ACTIVE_STATUSES: readonly ESessionStatus[] = [
  ESessionStatus.Preparing,
  ESessionStatus.Queued,
  ESessionStatus.Thinking,
  ESessionStatus.RunningTool,
  ESessionStatus.RunningCommand,
  ESessionStatus.WaitingToRetry,
  ESessionStatus.Resuming,
]

const isWaiting = (status: ESessionStatus | null): boolean =>
  status !== null && WAITING_STATUSES.includes(status)

const isActive = (row: InAppRow): boolean =>
  row.status !== null && ACTIVE_STATUSES.includes(row.status)

const statusOf = (row: InAppRow): ESessionStatus => row.status ?? ESessionStatus.Idle

const stampOf = (iso: string): number | null => {
  const stamp = Date.parse(iso)
  return Number.isNaN(stamp) ? null : stamp
}

const turnIsNewer = (args: { previous: InAppRow | undefined; row: InAppRow }): boolean => {
  const lastTurn = args.row.lastTurn
  if (lastTurn === null) return false
  const previousTurn = args.previous?.lastTurn ?? null
  return previousTurn === null || lastTurn.seq > previousTurn.seq
}

const momentOfRow = (args: {
  previous: InAppRow | undefined
  row: InAppRow
}): InAppMoment | null => {
  const { previous, row } = args
  if (previous === undefined) return null
  if (turnIsNewer(args)) {
    const moment = notifyMomentOf({ ending: row.lastTurn, status: statusOf(row) })
    return moment === null ? null : { row, moment, seq: row.lastTurn?.seq ?? 0 }
  }
  if (!isWaiting(row.status) || isWaiting(previous.status)) return null
  if (row.headSeq === null) return null
  const moment = notifyMomentOf({ ending: null, status: statusOf(row) })
  return moment === null ? null : { row, moment, seq: row.headSeq }
}

export const inAppRowOf = (source: InAppRowSource): InAppRow => ({
  sessionId: source.sessionId,
  title: source.title,
  status: source.status?.state ?? null,
  readSeq: source.readSeq ?? null,
  headSeq: source.headSeq ?? null,
  nested: source.nested === true && source.spawnedBy != null,
  lastTurn: source.lastTurn ?? null,
})

const dueNoticeOf = (args: {
  detected: InAppMoment
  openSessionId: string | null
  focused: boolean
  enabled: (moment: ENotifyMoment) => boolean
  now: string
}): AtlasNotification | null =>
  inAppNoticeOf({
    moment: args.detected.moment,
    sessionId: args.detected.row.sessionId,
    sessionTitle: args.detected.row.title,
    seq: args.detected.seq,
    readSeq: args.detected.row.readSeq,
    onScreen: args.detected.row.sessionId === args.openSessionId,
    focused: args.focused,
    enabled: args.enabled(args.detected.moment),
    now: args.now,
  })

export const dueNoticesOf = (args: {
  held: readonly HeldNotice[]
  rows: readonly InAppRow[]
  now: string
}): { moments: InAppMoment[]; held: HeldNotice[] } => {
  const now = stampOf(args.now) ?? 0
  const rows = new Map(args.rows.map((row) => [row.sessionId, row]))
  const moments: InAppMoment[] = []
  const held: HeldNotice[] = []
  for (const entry of args.held) {
    const row = rows.get(entry.sessionId)
    if (row === undefined || row.lastTurn === null) continue
    if (row.lastTurn.seq !== entry.seq || isActive(row)) continue
    const moment = notifyMomentOf({ ending: row.lastTurn, status: statusOf(row) })
    if (moment === null) continue
    const dueAt = stampOf(entry.dueAt)
    if (dueAt !== null && dueAt > now) {
      held.push(entry)
      continue
    }
    moments.push({ row, moment, seq: entry.seq })
  }
  return { moments, held }
}

export const inAppScanOf = (args: {
  previous: ReadonlyMap<string, InAppRow> | null
  next: readonly InAppRow[]
  held: readonly HeldNotice[]
  openSessionId: string | null
  focused: boolean
  enabled: (moment: ENotifyMoment) => boolean
  now: string
}): InAppScan => {
  const now = stampOf(args.now) ?? 0
  const fresh: InAppMoment[] = []
  const held: HeldNotice[] = []
  if (args.previous !== null) {
    const previous: ReadonlyMap<string, InAppRow> = args.previous
    for (const row of args.next) {
      const detected = momentOfRow({ previous: previous.get(row.sessionId), row })
      if (detected === null) continue
      const due = inAppDueOf({
        moment: detected.moment,
        lastTurn: row.lastTurn,
        nested: row.nested,
      })
      if ('show' in due && !due.show) continue
      if ('dueAt' in due && (stampOf(due.dueAt) ?? 0) > now) {
        held.push({ sessionId: row.sessionId, seq: detected.seq, dueAt: due.dueAt })
        continue
      }
      fresh.push(detected)
    }
  }
  const carried = dueNoticesOf({ held: args.held, rows: args.next, now: args.now })
  const notices = [...fresh, ...carried.moments].flatMap((detected) => {
    const notice = dueNoticeOf({
      detected,
      openSessionId: args.openSessionId,
      focused: args.focused,
      enabled: args.enabled,
      now: args.now,
    })
    return notice === null ? [] : [notice]
  })
  return { notices, held: [...held, ...carried.held] }
}

export const earliestDueAt = (held: readonly HeldNotice[]): string | null =>
  held.reduce<string | null>((earliest, entry) => {
    if (earliest === null) return entry.dueAt
    return (stampOf(entry.dueAt) ?? 0) < (stampOf(earliest) ?? 0) ? entry.dueAt : earliest
  }, null)

export const dueDelayMs = (args: { dueAt: string; nowMs: number }): number =>
  Math.max(0, (stampOf(args.dueAt) ?? args.nowMs) - args.nowMs)
