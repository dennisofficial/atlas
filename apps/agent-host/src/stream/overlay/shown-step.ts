import type { StreamServerMessage, StreamStepKey } from '@dltech/atlas-protocol'

import { sameStep } from './step-frames'

export const trackShown = (args: {
  shown: StreamStepKey | undefined
  message: StreamServerMessage
}): StreamStepKey | undefined => {
  const { message, shown } = args
  if (message.type === 'overlay') return message.key
  if (message.type === 'overlay-clear') return undefined
  if (message.type !== 'frame' || message.frame.type !== 'step-end') return shown
  return shown !== undefined && sameStep({ left: shown, right: message.frame.key })
    ? undefined
    : shown
}
