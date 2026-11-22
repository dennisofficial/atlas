import type { AgentOutput } from '@dltech/atlas-agent'

import { LiveStepBuffer } from './live-step-buffer'
import { fireLive, type HostBus, type HostTimers } from './ports'

export const liveOutputOf = (args: {
  bus: HostBus
  liveKey: string
  timers: HostTimers
  headSeq: () => number
  epoch: number
}): AgentOutput => {
  const { bus, liveKey } = args
  const steps = new LiveStepBuffer({
    timers: args.timers,
    headSeq: args.headSeq,
    epoch: args.epoch,
    emit: (frame) => bus.live({ key: liveKey, frame }),
  })
  return {
    emit: (event) => {
      if (event.type === 'step-start' || event.type === 'chunk' || event.type === 'step-end') {
        steps.push(event)
        return
      }
      if (event.type === 'tool-output') {
        fireLive({
          bus,
          key: liveKey,
          frame: {
            type: 'tool-output',
            callId: event.output.callId,
            text: event.output.text,
          },
        })
        return
      }
      if (event.type === 'retrying') {
        fireLive({
          bus,
          key: liveKey,
          frame: {
            type: 'retrying',
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
            reason: String(event.reason),
            delayMs: event.delayMs,
          },
        })
      }
    },
  }
}
