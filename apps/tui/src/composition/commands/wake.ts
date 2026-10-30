import { NOT_IN_THE_CLOUD, RAN, refused, type CommandEffect } from '@dltech/atlas-core'
import { EConnectionView } from '@dltech/atlas-harness'

export const ALREADY_UP = 'the cloud sandbox is already up'

export const RECONNECTING = 'the cloud sandbox is reconnecting'

export function wakeEffect(args: {
  view: EConnectionView | null
  wake: (() => void) | null
}): CommandEffect {
  const { view, wake } = args
  if (view === null || wake === null) return refused(NOT_IN_THE_CLOUD)

  switch (view) {
    case EConnectionView.Parked:
    case EConnectionView.Disconnected:
    case EConnectionView.Waking:
    case EConnectionView.Updating:
      wake()
      return RAN
    case EConnectionView.Connected:
      return refused(ALREADY_UP)
    case EConnectionView.Reconnecting:
      return refused(RECONNECTING)
    case EConnectionView.Detached:
      return refused(NOT_IN_THE_CLOUD)
  }
}
