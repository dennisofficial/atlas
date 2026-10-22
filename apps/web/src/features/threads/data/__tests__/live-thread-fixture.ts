import {
  decodeClientFrame,
  EClientFrame,
  encodeFrame,
  EServeFrame,
  type ChannelSocketHandlers,
  type ClientFrame,
  type ServeFrame,
} from '@dltech/atlas-client/channel'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { createLiveThreadController } from '../live-thread-controller'
import { IDLE_LIVE_THREAD, type LiveThreadState } from '../live-thread-view'
import { EPodConnectOutcome, type PodConnectResult } from '../pod-connect'

export type FakeSocket = {
  url: string
  protocols: readonly string[]
  handlers: ChannelSocketHandlers
  sent: ClientFrame[]
  closed: boolean
}

export const event = (seq: number, body = '{}'): WireEvent => ({
  id: `evt_${seq}`,
  threadId: 'thr_1',
  seq,
  runId: 'run_1',
  depth: 0,
  at: '2026-10-22T10:00:00.000Z',
  type: 'user-said',
  body,
})

export const flush = async () => {
  for (let round = 0; round < 5; round += 1) await new Promise<void>((done) => setTimeout(done, 0))
}

export const ticketOf = (token: string): PodConnectResult => ({
  outcome: EPodConnectOutcome.Ready,
  ticket: { url: 'https://pod.test', token, expiresAt: '2026-10-22T10:01:00.000Z' },
})

export function rig(options?: { mints?: PodConnectResult[]; seed?: WireEvent[] }) {
  const sockets: FakeSocket[] = []
  const retries: { delayMs: number; run: () => void }[] = []
  const mints = [...(options?.mints ?? [ticketOf('tkt1'), ticketOf('tkt2')])]
  let mintCount = 0
  let state: LiveThreadState = IDLE_LIVE_THREAD
  const history: LiveThreadState[] = []

  const controller = createLiveThreadController({
    threadId: 'thr_1',
    mint: async () => {
      mintCount += 1
      const next = mints.shift()
      if (next === undefined) throw new Error('no more tickets')
      return next
    },
    readSeed: async () => options?.seed ?? [event(1), event(2)],
    onChange: (next) => {
      state = next
      history.push(next)
    },
    scheduleReconnect: (task) => queueMicrotask(task.run),
    channelOptions: {
      scheduleRetry: (retry) => void retries.push(retry),
      scheduleTimeout: () => undefined,
      scheduleKeepalive: () => () => undefined,
      socketFactory: ({ url, protocols, handlers }) => {
        const fake: FakeSocket = { url, protocols, handlers, sent: [], closed: false }
        sockets.push(fake)
        return {
          send: (data) => {
            const frame = decodeClientFrame(data)
            if (frame !== null) fake.sent.push(frame)
          },
          close: () => void (fake.closed = true),
        }
      },
    },
  })

  const socket = (): FakeSocket => {
    const live = sockets.at(-1)
    if (live === undefined) throw new Error('no socket opened')
    return live
  }
  const receive = (frame: ServeFrame) => socket().handlers.handleMessage(encodeFrame(frame))
  const ready = () => {
    socket().handlers.handleOpen()
    receive({ kind: EServeFrame.Ready, seq: 0 })
  }
  const requests = () =>
    socket().sent.flatMap((frame) => (frame.kind === EClientFrame.Request ? [frame] : []))
  const answer = (args: { index: number; events: WireEvent[] }) => {
    const request = requests()[args.index]
    if (request === undefined) throw new Error('no request to answer')
    receive({
      kind: EServeFrame.Reply,
      replyTo: request.id,
      ok: true,
      data: { events: args.events },
    })
  }

  return {
    controller,
    sockets,
    retries,
    socket,
    receive,
    ready,
    requests,
    answer,
    state: () => state,
    history,
    mintCount: () => mintCount,
  }
}
