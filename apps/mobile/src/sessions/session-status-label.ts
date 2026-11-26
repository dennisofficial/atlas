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

const SHOWN_BY_ICON_ALONE: ReadonlySet<ESessionDisplay> = new Set([
  ESessionDisplay.Starting,
  ESessionDisplay.Working,
  ESessionDisplay.Idle,
  ESessionDisplay.Parked,
])

export const sessionStatusLabelOf = (display: ESessionDisplay | undefined): string | undefined =>
  display === undefined ? undefined : LABEL[display]

export const rowStatusLabelOf = (display: ESessionDisplay | undefined): string | undefined =>
  display === undefined || SHOWN_BY_ICON_ALONE.has(display) ? undefined : LABEL[display]
