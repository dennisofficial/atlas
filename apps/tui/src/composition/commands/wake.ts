import { EConnectionView } from '@dltech/atlas-harness'

import { RAN, type CommandEffect } from './local-command'
import { refused } from './registry'

export const NOT_IN_THE_CLOUD = 'this conversation is not parked in the cloud'

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
