import {
  ESessionStatus,
  ETurnEndedBy,
  ETurnOutcome,
  type AtlasNotification,
  ENotifyMoment,
  inAppNoticeOf,
  notifyMomentOf,
} from '@dltech/atlas-core'

export type InAppRow = {
  sessionId: string
  title: string | null
  status: ESessionStatus | null
  readSeq: number | null
  headSeq: number | null
  lastTurn: { seq: number; outcome: ETurnOutcome; by: ETurnEndedBy } | null
}

export type InAppRowSource = {
  sessionId: string
  title: string | null
  status?: { state: ESessionStatus } | null | undefined
  readSeq?: number | null | undefined
  headSeq?: number | null | undefined
  lastTurn?: { seq: number; outcome: ETurnOutcome; by: ETurnEndedBy } | null | undefined
}

export type InAppMoment = { row: InAppRow; moment: ENotifyMoment; seq: number }

const WAITING_STATUSES: readonly ESessionStatus[] = [
  ESessionStatus.WaitingForOperator,
  ESessionStatus.WaitingForCredentials,
]

const isWaiting = (status: ESessionStatus | null): boolean =>
  status !== null && WAITING_STATUSES.includes(status)

const statusOf = (row: InAppRow): ESessionStatus => row.status ?? ESessionStatus.Idle

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
  lastTurn: source.lastTurn ?? null,
})

export const inAppMomentsOf = (args: {
  previous: ReadonlyMap<string, InAppRow> | null
  next: readonly InAppRow[]
}): InAppMoment[] => {
  if (args.previous === null) return []
  const previous: ReadonlyMap<string, InAppRow> = args.previous
  return args.next.flatMap((row) => {
    const moment = momentOfRow({ previous: previous.get(row.sessionId), row })
    return moment === null ? [] : [moment]
  })
}

export const inAppNoticesOf = (args: {
  previous: ReadonlyMap<string, InAppRow> | null
  next: readonly InAppRow[]
  openSessionId: string | null
  focused: boolean
  enabled: (moment: ENotifyMoment) => boolean
  now: string
}): AtlasNotification[] =>
  inAppMomentsOf({ previous: args.previous, next: args.next }).flatMap((detected) => {
    const notice = inAppNoticeOf({
      moment: detected.moment,
      sessionId: detected.row.sessionId,
      sessionTitle: detected.row.title,
      seq: detected.seq,
      readSeq: detected.row.readSeq,
      onScreen: detected.row.sessionId === args.openSessionId,
      focused: args.focused,
      enabled: args.enabled(detected.moment),
      now: args.now,
    })
    return notice === null ? [] : [notice]
  })
