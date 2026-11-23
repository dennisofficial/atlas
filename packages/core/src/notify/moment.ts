import { ESessionStatus } from '../record/views/status-types'
import { ETurnEndedBy, ETurnOutcome } from '../record/turns'

export enum ENotifyMoment {
  TurnFinished = 'turn-finished',
  TurnFailed = 'turn-failed',
  WaitingForYou = 'waiting-for-you',
}

export type NotifySettingKey = 'finished' | 'errored' | 'approval'

const SETTING_KEY_BY_MOMENT: Record<ENotifyMoment, NotifySettingKey> = {
  [ENotifyMoment.TurnFinished]: 'finished',
  [ENotifyMoment.TurnFailed]: 'errored',
  [ENotifyMoment.WaitingForYou]: 'approval',
}

const WAITING_STATUSES: readonly ESessionStatus[] = [
  ESessionStatus.WaitingForOperator,
  ESessionStatus.WaitingForCredentials,
]

const momentOfEnding = (args: {
  outcome: ETurnOutcome
  by: ETurnEndedBy
  status: ESessionStatus
}): ENotifyMoment | null => {
  if (args.outcome === ETurnOutcome.Completed) return ENotifyMoment.TurnFinished
  if (args.outcome === ETurnOutcome.Failed) {
    return args.status === ESessionStatus.WaitingForCredentials
      ? ENotifyMoment.WaitingForYou
      : ENotifyMoment.TurnFailed
  }
  if (args.outcome === ETurnOutcome.Interrupted && args.by === ETurnEndedBy.Host) {
    return ENotifyMoment.TurnFailed
  }
  return null
}

export const notifyMomentOf = (args: {
  ending: { outcome: ETurnOutcome; by: ETurnEndedBy } | null
  status: ESessionStatus
}): ENotifyMoment | null => {
  if (args.ending !== null) return momentOfEnding({ ...args.ending, status: args.status })
  return WAITING_STATUSES.includes(args.status) ? ENotifyMoment.WaitingForYou : null
}

export const notifySettingKeyOf = (moment: ENotifyMoment): NotifySettingKey =>
  SETTING_KEY_BY_MOMENT[moment]
