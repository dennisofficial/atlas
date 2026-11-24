import { notificationCopyOf } from './copy'
import type { AtlasNotification } from './model'
import { ENotifyMoment } from './moment'
import { presenceIsFresh, type NotifyPresence } from './presence'

export type NotifyFacts = {
  moment: ENotifyMoment
  sessionId: string
  sessionTitle: string | null
  seq: number
  readSeq: number | null
  presence: readonly NotifyPresence[]
  devices: number
  quiet: boolean
  enabled: boolean
  superseded: boolean
  nested: boolean
  operatorTurn: boolean
  recentPush: boolean
  now: string
}

export enum ENotifyMode {
  InApp = 'in-app',
  Push = 'push',
  Silent = 'silent',
}

export enum ENotifySkip {
  Disabled = 'disabled',
  Quiet = 'quiet-hours',
  Read = 'already-read',
  OnScreen = 'on-screen',
  NoDevices = 'no-devices',
  Superseded = 'superseded',
  NestedAgentTurn = 'nested-agent-turn',
  SessionGone = 'session-gone',
}

export type NotifyPlan =
  | { mode: ENotifyMode.Push | ENotifyMode.InApp; notification: AtlasNotification; sound: boolean }
  | { mode: ENotifyMode.Silent; reason: ENotifySkip }

const silent = (reason: ENotifySkip): NotifyPlan => ({ mode: ENotifyMode.Silent, reason })

const alreadyRead = (facts: NotifyFacts): boolean =>
  facts.readSeq !== null && facts.readSeq >= facts.seq

const nestedAgentTurn = (facts: NotifyFacts): boolean =>
  facts.nested && facts.moment === ENotifyMoment.TurnFinished && !facts.operatorTurn

const notificationOf = (facts: NotifyFacts): AtlasNotification => ({
  sessionId: facts.sessionId,
  seq: facts.seq,
  moment: facts.moment,
  ...notificationCopyOf({ moment: facts.moment, sessionTitle: facts.sessionTitle }),
  at: facts.now,
})

export const pushNotificationOf = (plan: NotifyPlan): AtlasNotification | null =>
  plan.mode === ENotifyMode.Push ? plan.notification : null

export const notifyPlanOf = (args: { facts: NotifyFacts }): NotifyPlan => {
  const { facts } = args
  if (facts.superseded) return silent(ENotifySkip.Superseded)
  if (nestedAgentTurn(facts)) return silent(ENotifySkip.NestedAgentTurn)
  if (!facts.enabled) return silent(ENotifySkip.Disabled)
  if (facts.quiet) return silent(ENotifySkip.Quiet)
  if (alreadyRead(facts)) return silent(ENotifySkip.Read)
  const fresh = facts.presence.filter((record) =>
    presenceIsFresh({ at: record.at, now: facts.now }),
  )
  const onScreen = fresh.some((record) => record.foreground && record.sessionId === facts.sessionId)
  if (onScreen) return silent(ENotifySkip.OnScreen)
  const notification = notificationOf(facts)
  const sound = !facts.recentPush
  const inAtlas = fresh.some((record) => record.foreground)
  if (inAtlas) return { mode: ENotifyMode.InApp, notification, sound }
  if (facts.devices === 0) return silent(ENotifySkip.NoDevices)
  return { mode: ENotifyMode.Push, notification, sound }
}
