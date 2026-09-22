import type { ThreadId } from '@dltech/atlas-core'

import type { DeltaChannel } from '../channel/delta-channel'
import type { StepId } from '../channel/signal'

import type { FrameBuffer, SignalFrame } from './frame-buffer'

export type ChannelBridge = {
  /**
   * The frames of the step still streaming, which is what a client that cannot resume from its
   * cursor needs on top of the durable log: those deltas have no events behind them yet. Mirrors
   * `DeltaChannel.snapshot` while keeping the seq each frame was first sent under.
   *
   * Empty once the step's own `step-started` has aged out of the ring — a step longer than the ring
   * is ordinary — because a headless run of chunks mints a step on the client that can never end.
   */
  inFlight: () => readonly SignalFrame[]
  /** The step still streaming, whether or not its frames are still replayable. */
  liveStepId: () => StepId | null
  close: () => void
}

export function createChannelBridge(args: {
  channel: DeltaChannel
  threadId: ThreadId
  buffer: FrameBuffer
  onFrame: (frame: SignalFrame) => void
  onToolOutput?: (() => void) | undefined
}): ChannelBridge {
  let stepFrom: number | null = null
  let stepId: StepId | null = null

  const unsubscribe = args.channel.subscribe({
    threadId: args.threadId,
    listener: (signal) => {
      const frame = args.buffer.push(signal)
      if (signal.type === 'step-started') {
        stepFrom = frame.seq
        stepId = signal.stepId
      }
      if (signal.type === 'step-ended') {
        stepFrom = null
        stepId = null
      }
      if (signal.type === 'tool-output') args.onToolOutput?.()
      args.onFrame(frame)
    },
  })

  return {
    inFlight: () => {
      if (stepFrom === null || !args.buffer.contains(stepFrom)) return []
      return args.buffer.from(stepFrom)
    },

    liveStepId: () => stepId,

    close: unsubscribe,
  }
}
