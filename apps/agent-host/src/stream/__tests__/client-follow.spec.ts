import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  createStreamConnection,
  ESessionConnection,
  systemStreamScheduler,
  type StreamConnection,
  type StreamSocketFactory,
} from '@dltech/atlas-client/stream'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import {
  chainEvents,
  GENESIS_HASH,
  toRunId,
  toThreadId,
  type LogHead,
  type V2Body,
} from '@dltech/atlas-core'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startPgChangeFeed, type PgChangeFeed } from '../../bus/pg-change-feed'
import { createFollowSubscriptions, type FollowSubscriptions } from '../follow-port'
import { MemoryStreamAuth } from '../memory-stream-auth'
import { startStreamServer, type StreamServer } from '../stream-server'
import { systemHostTimers } from '../system-timers'
import { until } from './test-client'

const SESSION = 'client-session'
const THREAD = 'client-thread'
const AT = '2026-11-05T12:00:00.000Z'

const testDb = useTestDatabase()

const bunSocket: StreamSocketFactory = ({ url, handlers }) => {
  const socket = new WebSocket(url)
  socket.addEventListener('open', () => handlers.handleOpen())
  socket.addEventListener('message', (event) => handlers.handleMessage(String(event.data)))
  socket.addEventListener('close', (event) => handlers.handleClose(event.code))
  return {
    send: (data) => socket.send(data),
    close: (code) => socket.close(code),
  }
}

describe('the client SDK following a session over a real stream', () => {
  let plane: ControlPlane
  let feed: PgChangeFeed
  let follow: FollowSubscriptions
  let server: StreamServer
  let port = 0
  let epoch = 0
  let head: LogHead = { seq: 0, hash: GENESIS_HASH }
  const connections: StreamConnection[] = []
  const hashChecksAt: number[] = []

  const append = async (bodies: readonly V2Body[]): Promise<void> => {
    const events = chainEvents({
      threadId: toThreadId(THREAD),
      runId: toRunId('run-1'),
      epoch,
      at: AT,
      bodies,
      from: head,
    })
    const outcome = await plane.append({ threadId: THREAD, epoch, events })
    if (!outcome.ok) throw new Error('append refused')
    head = outcome.head
  }

  const startServer = (atPort: number): StreamServer => {
    const auth = new MemoryStreamAuth()
    auth.grant({ token: 'tok-a', userId: 'user-a', expiresAt: Date.now() + 3_600_000 })
    return startStreamServer({ port: atPort, auth, trustedOrigins: [], subscriptions: follow })
  }

  beforeEach(async () => {
    plane = new ControlPlane({ store: new PostgresControlStore(testDb().db) })
    const gapped = new Promise<void>((resolve) => {
      feed = startPgChangeFeed({ url: testDb().url })
      const off = feed.onGap(() => {
        off()
        resolve()
      })
    })
    await gapped
    const reading = plane
    follow = createFollowSubscriptions({
      plane: {
        readSession: (params) => reading.readSession(params),
        head: (params) => reading.head(params),
        readEvents: (params) => {
          if (!params.visible && params.limit === 1) hashChecksAt.push(params.afterSeq + 1)
          return reading.readEvents(params)
        },
        readInbox: (params) => reading.readInbox(params),
        currentLease: (params) => reading.currentLease(params),
        readBlob: (params) => reading.readBlob(params),
        hasMessageAfter: (params) => reading.hasMessageAfter(params),
      },
      feed,
      timers: systemHostTimers,
      log: undefined,
    })
    server = startServer(0)
    port = server.port
    await plane.createSession({
      sessionId: SESSION,
      userId: 'user-a',
      projectId: 'project-1',
      mainThreadId: THREAD,
    })
    epoch = (await plane.grant({ sessionId: SESSION, hostId: 1 })).epoch
    head = await plane.head({ threadId: THREAD })
  })

  afterEach(async () => {
    for (const connection of connections.splice(0)) connection.close()
    await server.stop()
    follow.close()
    await feed.close()
  })

  const connect = (): StreamConnection => {
    const connection = createStreamConnection({
      url: `ws://127.0.0.1:${port}/stream`,
      getToken: async () => 'tok-a',
      socket: bunSocket,
      scheduler: systemStreamScheduler,
    })
    connections.push(connection)
    return connection
  }

  it('catches up, goes live, follows appends and receives the status view', async () => {
    await append([{ type: 'workspace-prepared' }, { type: 'user-said', text: 'one' }])
    const session = connect().follow({ sessionId: SESSION })
    await until(
      () => session.getSnapshot().connection === ESessionConnection.Live,
      'the follower to go live',
    )
    expect(session.getSnapshot().events.map((event) => event.seq)).toEqual([1, 2])
    await append([{ type: 'user-said', text: 'two' }])
    await until(() => session.getSnapshot().cursor?.seq === 3, 'the appended event')
    await until(() => session.getSnapshot().status !== undefined, 'a status view')
    expect(session.getSnapshot().cursor).toEqual(head)
  }, 20_000)

  it('resumes from its cursor after the server restarts, with no gap and no duplicate', async () => {
    await append([
      { type: 'user-said', text: 'one' },
      { type: 'user-said', text: 'two' },
    ])
    const session = connect().follow({ sessionId: SESSION })
    await until(() => session.getSnapshot().cursor?.seq === 2, 'the first page')
    await server.stop()
    hashChecksAt.length = 0
    await append([{ type: 'user-said', text: 'three' }])
    server = startServer(port)
    await append([{ type: 'user-said', text: 'four' }])
    await until(() => session.getSnapshot().cursor?.seq === 4, 'events after the restart')
    expect(session.getSnapshot().events.map((event) => event.seq)).toEqual([1, 2, 3, 4])
    expect(session.getSnapshot().cursor).toEqual(head)
    expect(hashChecksAt).toEqual([2])
  }, 30_000)
})
