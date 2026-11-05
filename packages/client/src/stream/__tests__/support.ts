import {
  chainEvents,
  chainHash,
  toRunId,
  toThreadId,
  type LogHead,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'
import {
  parseClientMessage,
  type StreamClientMessage,
  type StreamServerMessage,
} from '@dltech/atlas-protocol'

import type { StreamScheduler, StreamSocketFactory, StreamSocketHandlers } from '../stream-ports'

const NOW = '2026-11-05T10:00:00.000Z'

export const userSaid = (text: string): V2Body => ({ type: 'user-said', text })

export const mintEvents = (params: {
  bodies: readonly V2Body[]
  from?: LogHead | undefined
  runId?: string
}): V2Event[] =>
  chainEvents({
    threadId: toThreadId('thread-1'),
    runId: toRunId(params.runId ?? 'run-1'),
    epoch: 1,
    at: NOW,
    from: params.from,
    bodies: params.bodies,
  })

export const mintUserEvents = (params: { count: number; from?: LogHead | undefined }): V2Event[] =>
  mintEvents({
    bodies: Array.from({ length: params.count }, (_, index) => userSaid(`m${index}`)),
    from: params.from,
  })

export const headOf = (events: readonly V2Event[]): LogHead => {
  const last = events[events.length - 1] as V2Event
  return { seq: last.seq, hash: chainHash(last) }
}

export const eventsMessage = (params: {
  id: string
  events: readonly V2Event[]
  live: boolean
}): StreamServerMessage => ({
  type: 'events',
  id: params.id,
  events: params.events.map((event) => ({ ...event })),
  head: headOf(params.events),
  live: params.live,
})

export const createFakeScheduler = () => {
  let time = 0
  let handles = 0
  let randomValue = 0.5
  const pending = new Map<number, { at: number; run: () => void }>()

  const scheduler: StreamScheduler = {
    now: () => time,
    setTimeout: (run, ms) => {
      handles += 1
      pending.set(handles, { at: time + ms, run })
      return handles
    },
    clearTimeout: (handle) => {
      if (typeof handle === 'number') pending.delete(handle)
    },
    random: () => randomValue,
  }

  const nextDue = (target: number) =>
    [...pending.entries()]
      .filter(([, timer]) => timer.at <= target)
      .sort((a, b) => a[1].at - b[1].at)[0]

  const advance = (ms: number): void => {
    const target = time + ms
    for (let due = nextDue(target); due !== undefined; due = nextDue(target)) {
      pending.delete(due[0])
      time = due[1].at
      due[1].run()
    }
    time = target
  }

  return {
    scheduler,
    advance,
    pendingCount: () => pending.size,
    setRandom: (value: number) => {
      randomValue = value
    },
  }
}

export type FakeSocket = {
  url: string
  sent: StreamClientMessage[]
  closedWith: (number | undefined)[]
  open(): void
  receive(message: StreamServerMessage): void
  receiveRaw(data: string): void
  drop(code: number): void
}

export const createFakeSockets = () => {
  const sockets: FakeSocket[] = []

  const factory: StreamSocketFactory = ({ url, handlers }) => {
    const socket = fakeSocketOf({ url, handlers })
    sockets.push(socket.fake)
    return socket.port
  }

  return { factory, sockets }
}

const fakeSocketOf = (params: { url: string; handlers: StreamSocketHandlers }) => {
  const { url, handlers } = params
  const fake: FakeSocket = {
    url,
    sent: [],
    closedWith: [],
    open: () => handlers.handleOpen(),
    receive: (message) => handlers.handleMessage(JSON.stringify(message)),
    receiveRaw: (data) => handlers.handleMessage(data),
    drop: (code) => handlers.handleClose(code),
  }
  const port = {
    send: (data: string) => {
      const parsed = parseClientMessage(JSON.parse(data))
      if (parsed.ok) fake.sent.push(parsed.message)
    },
    close: (code?: number) => {
      fake.closedWith.push(code)
    },
  }
  return { fake, port }
}

export const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve()
}
