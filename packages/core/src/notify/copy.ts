import { ENotifyMoment } from './moment'

export type NotificationCopy = { title: string; body: string }

const BODY_BY_MOMENT: Record<ENotifyMoment, string> = {
  [ENotifyMoment.TurnFinished]: 'Finished',
  [ENotifyMoment.TurnFailed]: 'Failed — open Atlas to see why',
  [ENotifyMoment.WaitingForYou]: 'Atlas needs you',
}

export const notificationCopyOf = (args: {
  moment: ENotifyMoment
  sessionTitle: string | null
}): NotificationCopy => {
  const title = args.sessionTitle?.trim()
  return {
    title: title === undefined || title === '' ? 'Atlas' : title,
    body: BODY_BY_MOMENT[args.moment],
  }
}
