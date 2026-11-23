import { notificationCopyOf } from './copy'
import type { AtlasNotification } from './model'
import type { ENotifyMoment } from './moment'
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
  now: string
}

export enum ENotifyMode {
  InApp = 'in-app',
  Push = 'push',
}

export type NotifyPlan = { mode: ENotifyMode; notification: AtlasNotification }

const alreadyRead = (facts: NotifyFacts): boolean =>
  facts.readSeq !== null && facts.readSeq >= facts.seq

const notificationOf = (facts: NotifyFacts): AtlasNotification => ({
  sessionId: facts.sessionId,
  seq: facts.seq,
  moment: facts.moment,
  ...notificationCopyOf({ moment: facts.moment, sessionTitle: facts.sessionTitle }),
  at: facts.now,
})

export const notifyPlanOf = (args: { facts: NotifyFacts }): NotifyPlan | null => {
  const { facts } = args
  if (!facts.enabled) return null
  if (facts.quiet) return null
  if (alreadyRead(facts)) return null
  const fresh = facts.presence.filter((record) =>
    presenceIsFresh({ at: record.at, now: facts.now }),
  )
  const onScreen = fresh.some((record) => record.foreground && record.sessionId === facts.sessionId)
  if (onScreen) return null
  const notification = notificationOf(facts)
  const inAtlas = fresh.some((record) => record.foreground)
  if (inAtlas) return { mode: ENotifyMode.InApp, notification }
  if (facts.devices === 0) return null
  return { mode: ENotifyMode.Push, notification }
}
