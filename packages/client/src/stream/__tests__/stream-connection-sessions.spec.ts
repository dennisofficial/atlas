import { describe, expect, it } from 'bun:test'
import {
  EStreamSubscribeKind,
  STREAM_PROTOCOL_VERSION,
  type StreamSessionRow,
} from '@dltech/atlas-protocol'

import { createStreamConnection } from '../stream-connection'
import { createFakeScheduler, createFakeSockets, settle } from './support'

const READY = { type: 'ready', v: STREAM_PROTOCOL_VERSION, connectionId: 'c1' } as const

const rowOf = (overrides: Partial<StreamSessionRow> = {}): StreamSessionRow => ({
  sessionId: 'a',
  projectId: 'p1',
  title: 'Fix login',
  naming: false,
  mainThreadId: 'thr-a',
  createdAt: '2026-11-05T10:00:00.000Z',
  updatedAt: '2026-11-05T10:00:00.000Z',
  archivedAt: null,
  ...overrides,
})

const setup = () => {
  const clock = createFakeScheduler()
  const fakes = createFakeSockets()
  const connection = createStreamConnection({
    url: 'wss://stream.test/v1/stream',
    getToken: () => Promise.resolve('token'),
    socket: fakes.factory,
    scheduler: clock.scheduler,
  })
  return { connection, clock, sockets: fakes.sockets }
}

const bringUp = async (params: {
  sockets: ReturnType<typeof createFakeSockets>['sockets']
  index: number
}) => {
  const socket = params.sockets[params.index]
  if (socket === undefined) throw new Error('no socket')
  socket.open()
  await settle()
  socket.receive(READY)
  await settle()
  return socket
}

describe('followSessions', () => {
  it('connects, subscribes right after ready and has no snapshot until one arrives', async () => {
    const { connection, sockets } = setup()
    const list = connection.followSessions({ projectId: 'p1' })
    expect(sockets).toHaveLength(1)
    expect(list.getSnapshot()).toBeUndefined()
    const socket = await bringUp({ sockets, index: 0 })
    expect(socket.sent[1]).toEqual({
      type: 'subscribe',
      id: 'l1',
      kind: EStreamSubscribeKind.Sessions,
      projectId: 'p1',
    })
  })

  it('omits the project filter when none is given', async () => {
    const { connection, sockets } = setup()
    connection.followSessions()
    const socket = await bringUp({ sockets, index: 0 })
    expect(socket.sent[1]).toEqual({
      type: 'subscribe',
      id: 'l1',
      kind: EStreamSubscribeKind.Sessions,
    })
  })

  it('subscribes immediately when followed on an open connection', async () => {
    const { connection, sockets } = setup()
    connection.connect()
    const socket = await bringUp({ sockets, index: 0 })
    connection.followSessions()
    expect(socket.sent[1]).toMatchObject({ type: 'subscribe', id: 'l1' })
  })

  it('folds snapshot, upsert and remove and notifies listeners', async () => {
    const { connection, sockets } = setup()
    const list = connection.followSessions()
    const socket = await bringUp({ sockets, index: 0 })
    let calls = 0
    list.subscribe(() => void (calls += 1))
    socket.receive({ type: 'snapshot', id: 'l1', rows: [rowOf(), rowOf({ sessionId: 'b' })] })
    expect(list.getSnapshot()?.map((row) => row.sessionId)).toEqual(['a', 'b'])
    socket.receive({ type: 'upsert', id: 'l1', row: rowOf({ title: 'Renamed' }) })
    socket.receive({ type: 'upsert', id: 'l1', row: rowOf({ sessionId: 'c' }) })
    expect(list.getSnapshot()?.map((row) => `${row.sessionId}:${row.title}`)).toEqual([
      'a:Renamed',
      'b:Fix login',
      'c:Fix login',
    ])
    socket.receive({ type: 'remove', id: 'l1', sessionId: 'b' })
    expect(list.getSnapshot()?.map((row) => row.sessionId)).toEqual(['a', 'c'])
    expect(calls).toBe(4)
  })

  it('re-subscribes after a reconnect and lets the new snapshot replace old rows', async () => {
    const { connection, clock, sockets } = setup()
    const list = connection.followSessions()
    const first = await bringUp({ sockets, index: 0 })
    first.receive({ type: 'snapshot', id: 'l1', rows: [rowOf(), rowOf({ sessionId: 'b' })] })
    first.drop(1006)
    expect(list.getSnapshot()).toHaveLength(2)
    clock.advance(500)
    const second = await bringUp({ sockets, index: 1 })
    expect(second.sent[1]).toEqual({
      type: 'subscribe',
      id: 'l1',
      kind: EStreamSubscribeKind.Sessions,
    })
    second.receive({ type: 'snapshot', id: 'l1', rows: [rowOf({ sessionId: 'c' })] })
    expect(list.getSnapshot()?.map((row) => row.sessionId)).toEqual(['c'])
  })

  it('sends unsubscribe on close and stops delivering', async () => {
    const { connection, sockets } = setup()
    const list = connection.followSessions()
    const socket = await bringUp({ sockets, index: 0 })
    list.close()
    expect(socket.sent[2]).toEqual({ type: 'unsubscribe', id: 'l1' })
    socket.receive({ type: 'snapshot', id: 'l1', rows: [rowOf()] })
    expect(list.getSnapshot()).toBeUndefined()
  })

  it('ignores messages addressed to other ids', async () => {
    const { connection, sockets } = setup()
    const list = connection.followSessions()
    const socket = await bringUp({ sockets, index: 0 })
    socket.receive({ type: 'snapshot', id: 'l9', rows: [rowOf()] })
    socket.receive({ type: 'upsert', id: 's1', row: rowOf() })
    expect(list.getSnapshot()).toBeUndefined()
  })
})
