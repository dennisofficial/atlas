import type { TurnNotify } from '../record/turns'
import { notificationCopyOf } from './copy'
import { ENotifyVerdict, notifyDecisionOfKinds } from './decision'
import type { AtlasNotification } from './model'
import { ENotifyMoment } from './moment'

export type InAppEnding = {
  at?: string | null | undefined
  notify?: TurnNotify | null | undefined
}

export type InAppDue = { show: false } | { show: true } | { dueAt: string }

const stampOf = (at: string | null | undefined): number | null => {
  if (at === null || at === undefined) return null
  const stamp = Date.parse(at)
  return Number.isNaN(stamp) ? null : stamp
}

export const inAppDueOf = (args: {
  moment: ENotifyMoment
  lastTurn: InAppEnding | null
  nested: boolean
}): InAppDue => {
  if (args.moment !== ENotifyMoment.TurnFinished) return { show: true }
  const notify = args.lastTurn?.notify ?? null
  if (notify === null) return { show: true }
  if (args.nested && !notify.operatorTurn) return { show: false }
  const decision = notifyDecisionOfKinds({
    moment: args.moment,
    pending: notify.pending,
    operatorTurn: notify.operatorTurn,
  })
  const at = stampOf(args.lastTurn?.at)
  if (decision.verdict === ENotifyVerdict.Send || at === null) return { show: true }
  return { dueAt: new Date(at + decision.holdMs).toISOString() }
}

export const inAppNoticeOf = (args: {
  moment: ENotifyMoment
  sessionId: string
  sessionTitle: string | null
  seq: number
  readSeq: number | null
  onScreen: boolean
  focused: boolean
  enabled: boolean
  now: string
}): AtlasNotification | null => {
  if (!args.enabled) return null
  if (!args.focused) return null
  if (args.onScreen) return null
  if (args.readSeq !== null && args.readSeq >= args.seq) return null
  return {
    sessionId: args.sessionId,
    seq: args.seq,
    moment: args.moment,
    ...notificationCopyOf({ moment: args.moment, sessionTitle: args.sessionTitle }),
    at: args.now,
  }
}
