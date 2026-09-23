import type { ChannelSignal } from '../channel/signal'
import { EServeFrame, type ServeFrame } from '../cloud/channel-wire'

export const DEFAULT_FRAME_BUFFER = 2048

export type SignalFrame = Extract<ServeFrame, { kind: EServeFrame.Signal }>
export type LifecycleFrame = Extract<
  ServeFrame,
  { kind: EServeFrame.TurnEnded | EServeFrame.Error }
>

export type BufferedFrame = SignalFrame | (LifecycleFrame & { seq: number })

export type FrameBuffer = {
  push: (signal: ChannelSignal) => SignalFrame
  pushLifecycle: (frame: LifecycleFrame) => BufferedFrame
  nextSeq: () => number
  holds: (cursor: number) => boolean
  /** Whether that frame itself is still in the ring, which `holds` deliberately is not: it accepts the seq just before the oldest. */
  contains: (seq: number) => boolean
  after: (cursor: number) => readonly ServeFrame[]
  from: (seq: number) => readonly SignalFrame[]
}

const wireOf = (buffered: BufferedFrame): ServeFrame => {
  if (buffered.kind === EServeFrame.TurnEnded) {
    return { kind: buffered.kind, outcome: buffered.outcome }
  }
  if (buffered.kind === EServeFrame.Error) {
    return { kind: buffered.kind, message: buffered.message }
  }
  return buffered
}

export function createFrameBuffer(args: { capacity: number }): FrameBuffer {
  const held: BufferedFrame[] = []
  let next = 0

  const oldest = (): number => held[0]?.seq ?? next

  const keep = <T extends BufferedFrame>(frame: T): T => {
    held.push(frame)
    if (held.length > args.capacity) held.splice(0, held.length - args.capacity)
    return frame
  }

  return {
    push(signal) {
      const frame: SignalFrame = { kind: EServeFrame.Signal, seq: next, signal }
      next += 1
      return keep(frame)
    },

    pushLifecycle(frame) {
      const buffered: BufferedFrame = { ...frame, seq: next }
      next += 1
      return keep(buffered)
    },

    nextSeq: () => next,

    holds: (cursor) => cursor < next && cursor >= oldest() - 1,

    contains: (seq) => seq < next && seq >= oldest() && held.length > 0,

    after: (cursor) => held.filter((frame) => frame.seq > cursor).map(wireOf),

    from: (seq) =>
      held.flatMap((frame) =>
        frame.seq >= seq && frame.kind === EServeFrame.Signal ? [frame] : [],
      ),
  }
}
