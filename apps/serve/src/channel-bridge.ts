import type { ThreadId } from '@dltech/atlas-core'

import type { DeltaChannel } from '@dltech/atlas-harness'
import type { StepId } from '@dltech/atlas-harness'
import { EServeFrame } from '@dltech/atlas-harness'

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

  // A subscribe mid-turn opens with the channel's held replay, whose synthetic working signal has
  // no live seq to enter the ring under; the flag is seeded from it ahead of the listener instead.
  let working = args.channel
    .snapshot({ threadId: args.threadId })
    .some((signal) => signal.type === 'turn-working' && signal.working)

  const unsubscribe = args.channel.subscribe({
    threadId: args.threadId,
    listener: (signal) => {
      const frame = args.buffer.push(signal)
      if (signal.type === 'turn-working') working = signal.working
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

  // A backfill head naming buffer.nextSeq() would be replayed to a cursor-resuming client as the
  // live working frame arriving after it. Next = nextSeq() - 1 parses (seq is only nonnegative),
  // sits before every buffered seq, and collides with nothing already sent.
  const workingHead = (): SignalFrame => ({
    kind: EServeFrame.Signal,
    seq: args.buffer.nextSeq() - 1,
    signal: { type: 'turn-working', working: true },
  })

  return {
    inFlight: () => {
      const steps =
        stepFrom === null || !args.buffer.contains(stepFrom) ? [] : args.buffer.from(stepFrom)
      return working ? [workingHead(), ...steps] : steps
    },

    liveStepId: () => stepId,

    close: unsubscribe,
  }
}
