import type { ThreadId } from '@dltech/atlas-core'
import { EServeFrame, type ChannelSignal, type DeltaChannel } from '@dltech/atlas-harness'

import type { FrameBuffer } from './frame-buffer'
import { sendFrame } from './frame-egress'
import type { SessionHandlersArgs, SessionSocket } from './socket-session-types'

type EchoedSignal = Extract<
  ChannelSignal,
  {
    type:
      | 'events-appended'
      | 'turn-working'
      | 'pending-changed'
      | 'operator-input'
      | 'context-changed'
  }
>

const ECHOABLE = new Set<ChannelSignal['type']>([
  'events-appended',
  'turn-working',
  'pending-changed',
  'operator-input',
  'context-changed',
])

const tagAt = (signal: ChannelSignal, threadId: ThreadId): EchoedSignal | null => {
  if (!ECHOABLE.has(signal.type)) return null
  if (signal.type === 'turn-working') return { ...signal, threadId }
  if (signal.type === 'events-appended') return { ...signal, threadId }
  if (signal.type === 'pending-changed') return { ...signal, threadId }
  if (signal.type === 'operator-input') return { ...signal, threadId }
  return { type: 'context-changed' }
}

export function createChildEcho(args: {
  channel: Pick<DeltaChannel, 'subscribe'>
  attached: () => readonly SessionSocket[]
  buffer: Pick<FrameBuffer, 'nextSeq'>
  root: ThreadId
}) {
  const echoes = new Map<ThreadId, { unsubscribe: () => void; viewers: number }>()

  const ensure = (threadId: ThreadId): void => {
    if (threadId === args.root) return
    const held = echoes.get(threadId)
    if (held !== undefined) {
      held.viewers += 1
      return
    }
    const unsubscribe = args.channel.subscribe({
      threadId,
      listener: (signal) => {
        const tagged = tagAt(signal, threadId)
        if (tagged === null) return
        // An echo rides outside the buffered stream: like the greeter's snapshot frames it
        // borrows the next live seq - 1, so a cursor-resuming viewer ignores it and a live
        // viewer accepts it without tripping the gap check (remote-channel-frames.ts).
        const seq = Math.max(0, args.buffer.nextSeq() - 1)
        for (const socket of args.attached()) {
          if (socket.data.threadId !== threadId) continue
          sendFrame({
            socket,
            frame: { kind: EServeFrame.Signal, seq, signal: tagged },
          })
        }
      },
    })
    echoes.set(threadId, { unsubscribe, viewers: 1 })
  }

  const release = (threadId: ThreadId): void => {
    const held = echoes.get(threadId)
    if (held === undefined) return
    held.viewers -= 1
    if (held.viewers > 0) return
    held.unsubscribe()
    echoes.delete(threadId)
  }

  return { ensure, release }
}

export type ChildEcho = {
  viewed: (socket: SessionSocket) => void
  detached: (socket: SessionSocket) => void
}

export const childEchoOf = (args: {
  channel: SessionHandlersArgs['channel']
  buffer: Pick<FrameBuffer, 'nextSeq'>
  root: ThreadId
  attached: () => readonly SessionSocket[]
}): ChildEcho => {
  const NOOP: ChildEcho = { viewed: () => undefined, detached: () => undefined }
  if (args.channel === undefined) return NOOP
  const echo = createChildEcho({
    channel: args.channel,
    attached: args.attached,
    buffer: args.buffer,
    root: args.root,
  })
  return {
    viewed: (socket) => {
      if (socket.data.threadId !== undefined) echo.ensure(socket.data.threadId)
    },
    detached: (socket) => {
      if (socket.data.threadId !== undefined) echo.release(socket.data.threadId)
    },
  }
}
