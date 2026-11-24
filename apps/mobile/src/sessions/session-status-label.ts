import { ESessionDisplay } from '@dltech/atlas-client/stream'

const LABEL: Record<ESessionDisplay, string> = {
  [ESessionDisplay.Starting]: 'Starting',
  [ESessionDisplay.StartFailed]: 'Start failed',
  [ESessionDisplay.Working]: 'Working',
  [ESessionDisplay.WaitingForYou]: 'Waiting for you',
  [ESessionDisplay.Idle]: 'Idle',
  [ESessionDisplay.Parked]: 'Parked',
  [ESessionDisplay.Failed]: 'Failed',
}

export const sessionStatusLabelOf = (display: ESessionDisplay | undefined): string | undefined =>
  display === undefined ? undefined : LABEL[display]
