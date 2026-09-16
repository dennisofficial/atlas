import type { ChannelSignal } from '../channel/signal'
import { EServeFrame, type ServeFrame } from '../cloud/channel-wire'

export const DEFAULT_FRAME_BUFFER = 2048

export type SignalFrame = Extract<ServeFrame, { kind: EServeFrame.Signal }>

export type FrameBuffer = {
  push: (signal: ChannelSignal) => SignalFrame
  nextSeq: () => number
  holds: (cursor: number) => boolean
  /** Whether that frame itself is still in the ring, which `holds` deliberately is not: it accepts the seq just before the oldest. */
  contains: (seq: number) => boolean
  after: (cursor: number) => readonly SignalFrame[]
  from: (seq: number) => readonly SignalFrame[]
}

export function createFrameBuffer(args: { capacity: number }): FrameBuffer {
  const held: SignalFrame[] = []
  let next = 0

  const oldest = (): number => held[0]?.seq ?? next

  return {
    push(signal) {
      const frame: SignalFrame = { kind: EServeFrame.Signal, seq: next, signal }
      next += 1
      held.push(frame)
      if (held.length > args.capacity) held.splice(0, held.length - args.capacity)
      return frame
    },

    nextSeq: () => next,

    holds: (cursor) => cursor < next && cursor >= oldest() - 1,

    contains: (seq) => seq < next && seq >= oldest() && held.length > 0,

    after: (cursor) => held.filter((frame) => frame.seq > cursor),

    from: (seq) => held.filter((frame) => frame.seq >= seq),
  }
}
