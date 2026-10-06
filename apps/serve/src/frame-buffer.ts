import type { ChannelSignal } from '@dltech/atlas-harness'
import { EServeFrame, type ServeFrame } from '@dltech/atlas-harness'

export const DEFAULT_FRAME_BUFFER = 2048

export type SignalFrame = Extract<ServeFrame, { kind: EServeFrame.Signal }>
export type LifecycleFrame = Extract<
  ServeFrame,
  { kind: EServeFrame.TurnEnded | EServeFrame.Error | EServeFrame.Reload }
>

export type FrameBuffer = {
  push: (signal: ChannelSignal) => SignalFrame
  pushLifecycle: (frame: LifecycleFrame) => LifecycleFrame
  nextSeq: () => number
  holds: (cursor: number) => boolean
  contains: (seq: number) => boolean
  after: (cursor: number) => readonly ServeFrame[]
  from: (seq: number) => readonly SignalFrame[]
}

type Held = { position: number; frame: SignalFrame | LifecycleFrame }

const NOTHING_EVICTED = -1

export function createFrameBuffer(args: { capacity: number }): FrameBuffer {
  const held: Held[] = []
  let next = 0
  let evictedThrough = NOTHING_EVICTED

  const keep = <T extends SignalFrame | LifecycleFrame>(frame: T): T => {
    held.push({ position: next, frame })
    const overflow = held.length - args.capacity
    if (overflow > 0) {
      for (const dropped of held.splice(0, overflow)) {
        evictedThrough = Math.max(evictedThrough, dropped.position)
      }
    }
    return frame
  }

  return {
    push(signal) {
      const frame: SignalFrame = { kind: EServeFrame.Signal, seq: next, signal }
      const kept = keep(frame)
      next += 1
      return kept
    },

    pushLifecycle: (frame) => keep(frame),

    nextSeq: () => next,

    holds: (cursor) => cursor < next && cursor >= evictedThrough,

    contains: (seq) =>
      held.some((entry) => entry.frame.kind === EServeFrame.Signal && entry.frame.seq === seq),

    after: (cursor) => held.filter((entry) => entry.position > cursor).map((entry) => entry.frame),

    from: (seq) =>
      held.flatMap((entry) =>
        entry.frame.kind === EServeFrame.Signal && entry.frame.seq >= seq ? [entry.frame] : [],
      ),
  }
}
