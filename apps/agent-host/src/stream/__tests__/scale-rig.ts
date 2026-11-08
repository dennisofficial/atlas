import { join } from 'node:path'

import {
  createStreamConnection,
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
import type { TestDatabase } from '@dltech/atlas-db/testing'

import { startPgChangeFeed, type PgChangeFeed } from '../../bus/pg-change-feed'
import { createFollowSubscriptions, type FollowSubscriptions } from '../follow-port'
import { MemoryStreamAuth } from '../memory-stream-auth'
import { startStreamServer, type StreamServer } from '../stream-server'
import { systemHostTimers } from '../system-timers'

const AT = '2026-11-07T12:00:00.000Z'
const FOLLOWER_MAIN = join(import.meta.dir, 'support/fanout-followers-main.ts')
const SENTENCE = 'the quick brown fox reads a very long transcript line before answering. '

export const bunSocket: StreamSocketFactory = ({ url, handlers }) => {
  const socket = new WebSocket(url)
  socket.addEventListener('open', () => handlers.handleOpen())
  socket.addEventListener('message', (event) => handlers.handleMessage(String(event.data)))
  socket.addEventListener('close', (event) => handlers.handleClose(event.code))
  return {
    send: (data) => socket.send(data),
    close: (code) => socket.close(code),
  }
}

export const percentile = (values: readonly number[], fraction: number): number =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * fraction))
  ] ?? 0

export const realisticBody = (index: number): V2Body => {
  const text = `message ${index}: ${SENTENCE.repeat(2 + (index % 3))}`
  if (index % 2 === 0) return { type: 'user-said', text }
  return { type: 'assistant-said', parts: [{ type: 'text', text }] }
}

export type ScaleRig = {
  sessionId: string
  port: number
  head(): LogHead
  append(bodies: readonly V2Body[]): Promise<void>
  seed(total: number): Promise<void>
  connect(): StreamConnection
  stop(): Promise<void>
}

export const startScaleRig = async (args: {
  database: TestDatabase
  sessionId: string
  maxConnectionsPerUser: number
}): Promise<ScaleRig> => {
  const { database, sessionId } = args
  const threadId = `thread-${sessionId}`
  const plane = new ControlPlane({ store: new PostgresControlStore(database.db) })
  let feed: PgChangeFeed | undefined
  await new Promise<void>((resolve) => {
    feed = startPgChangeFeed({ url: database.url })
    const off = feed.onGap(() => {
      off()
      resolve()
    })
  })
  if (feed === undefined) throw new Error('change feed did not start')
  const changeFeed = feed
  const follow: FollowSubscriptions = createFollowSubscriptions({
    plane,
    feed: changeFeed,
    timers: systemHostTimers,
    log: undefined,
  })
  const auth = new MemoryStreamAuth()
  auth.grant({ token: 'tok-a', userId: 'user-a', expiresAt: Date.now() + 3_600_000 })
  const server: StreamServer = startStreamServer({
    port: 0,
    auth,
    trustedOrigins: [],
    subscriptions: follow,
    maxConnectionsPerUser: args.maxConnectionsPerUser,
  })
  await plane.createSession({
    sessionId,
    userId: 'user-a',
    projectId: 'project-1',
    mainThreadId: threadId,
  })
  const { epoch } = await plane.grant({ sessionId, hostId: 1 })
  let head: LogHead = { seq: 0, hash: GENESIS_HASH }
  const connections: StreamConnection[] = []

  const append = async (bodies: readonly V2Body[]): Promise<void> => {
    const events = chainEvents({
      threadId: toThreadId(threadId),
      runId: toRunId('run-1'),
      epoch,
      at: AT,
      bodies,
      from: head,
    })
    const outcome = await plane.append({ threadId, epoch, events })
    if (!outcome.ok) throw new Error('append refused')
    head = outcome.head
  }

  return {
    sessionId,
    port: server.port,
    head: () => head,
    append,
    seed: async (total) => {
      for (let from = 0; from < total; from += 500) {
        const size = Math.min(500, total - from)
        await append(Array.from({ length: size }, (_, i) => realisticBody(from + i)))
      }
    },
    connect: () => {
      const connection = createStreamConnection({
        url: `ws://127.0.0.1:${server.port}/stream`,
        getToken: async () => 'tok-a',
        socket: bunSocket,
        scheduler: systemStreamScheduler,
      })
      connections.push(connection)
      return connection
    },
    stop: async () => {
      for (const connection of connections.splice(0)) connection.close()
      await server.stop()
      follow.close()
      await changeFeed.close()
    },
  }
}

export type FollowersReport = {
  followers: number
  received: number
  expected: number
  p50: number
  p99: number
  max: number
  gaps: number
  duplicates: number
  closed: number
  live: number
}

export type FollowerProcess = {
  ready: Promise<void>
  finish(): Promise<FollowersReport>
  kill(): void
}

export const spawnFollowers = (args: {
  port: number
  sessionId: string
  followers: number
  appends: number
}): FollowerProcess => {
  const child = Bun.spawn({
    cmd: ['bun', FOLLOWER_MAIN],
    env: {
      ...process.env,
      STREAM_URL: `ws://127.0.0.1:${args.port}/stream`,
      SESSION_ID: args.sessionId,
      FOLLOWERS: String(args.followers),
      APPENDS: String(args.appends),
    },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'inherit',
  })
  const reader = child.stdout.getReader()
  const decoder = new TextDecoder()
  let output = ''
  const readUntil = async (marker: string): Promise<void> => {
    while (!output.includes(marker)) {
      const chunk = await reader.read()
      if (chunk.done) throw new Error(`followers exited before ${marker}`)
      output += decoder.decode(chunk.value)
    }
  }
  return {
    ready: readUntil('ready\n'),
    finish: async () => {
      child.stdin.write('stop\n')
      await child.stdin.flush()
      await readUntil('}\n')
      const line = output.split('\n').find((candidate) => candidate.startsWith('{'))
      if (line === undefined) throw new Error('followers reported nothing')
      await child.exited
      return JSON.parse(line) as FollowersReport
    },
    kill: () => child.kill(),
  }
}
