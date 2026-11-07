import { Logger } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { chainEvents, toRunId, toThreadId } from '@dltech/atlas-core'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { PG_CHANGE_CHANNEL } from '@dltech/atlas-protocol'
import pg from 'pg'
import { advanceTimersByTimeAsync } from '../../../../test/fake-timers'
import { prepareDelivery, REST_FIELDS } from './github-delivery.fixture'
import { localObservations } from './github-observation.fixture'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { inertSignals } from '../../platform/sessions/thread-signals.fixture'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { GithubPrStateWriter } from './github-pr-state-writer'
import type { GithubSandboxWakeService } from './github-sandbox-wake.service'
import type { GithubPrStateDto } from './github-realtime.types'

function writerRig() {
  const fanout = new GithubPrFanoutService(new DrainStateService())
  const wake = { notifyEvent: () => undefined } as unknown as GithubSandboxWakeService
  const writer = new GithubPrStateWriter({
    mailbox: new GithubPrEventMailboxService(fanout, wake),
    fanout,
    signals: inertSignals(),
    observations: localObservations(),
    logger: new Logger('github-pr-state-writer.spec'),
  })
  return { writer, fanout }
}

const write = (args: { writer: GithubPrStateWriter; checksPassed: number }) =>
  db.transaction((tx) =>
    args.writer.writeState({
      tx,
      repoFullName: 'compai/app',
      prNumber: 42,
      fields: { ...REST_FIELDS, checksPassed: args.checksPassed, updatedAt: new Date() },
    }),
  )

describe('GithubPrStateWriter versions', () => {
  useTestDatabase()

  beforeEach(async () => {
    await prepareDelivery()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('numbers each committed write of a PR one higher than the last', async () => {
    const { writer } = writerRig()
    const first = await write({ writer, checksPassed: 1 })
    const second = await write({ writer, checksPassed: 2 })
    expect([first.row.version, second.row.version]).toEqual([1, 2])
  })

  it('delivers only the newest state when publishing happens out of commit order', async () => {
    const { writer, fanout } = writerRig()
    const received: GithubPrStateDto[] = []
    fanout.openStream({ userId: 'usr-a', handler: (state) => received.push(state) })
    const first = await write({ writer, checksPassed: 1 })
    const second = await write({ writer, checksPassed: 2 })

    await writer.publish({ ...second, userIds: ['usr-a'] })
    await writer.publish({ ...first, userIds: ['usr-a'] })
    await advanceTimersByTimeAsync(1_100)

    expect(received.map((state) => [state.version, state.checksPassed])).toEqual([[2, 2]])
  })
})

describe('GithubPrStateWriter session announcements', () => {
  useTestDatabase()

  const heard: string[] = []
  let listener: pg.Client

  const linkSession = async (args: { sessionId: string; number: number }) => {
    const plane = new ControlPlane({ store: new PostgresControlStore(db) })
    await plane.createSession({
      sessionId: args.sessionId,
      userId: 'usr-a',
      projectId: 'proj-a',
      mainThreadId: `${args.sessionId}-thread`,
    })
    const lease = await plane.grant({ sessionId: args.sessionId, hostId: 1 })
    const outcome = await plane.append({
      threadId: `${args.sessionId}-thread`,
      epoch: lease.epoch,
      events: chainEvents({
        threadId: toThreadId(`${args.sessionId}-thread`),
        runId: toRunId('run-1'),
        epoch: lease.epoch,
        at: new Date().toISOString(),
        bodies: [
          {
            type: 'pull-request-linked',
            number: args.number,
            url: `https://github.com/compai/app/pull/${args.number}`,
            repo: 'github.com/CompAI/App',
            branch: 'feat',
          },
        ],
      }),
    })
    expect(outcome.ok).toBe(true)
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 200))

  beforeEach(async () => {
    await prepareDelivery()
    heard.length = 0
    listener = new pg.Client(process.env.DATABASE_URL)
    await listener.connect()
    listener.on('notification', (message) => {
      if (message.payload === undefined) return
      heard.push((JSON.parse(message.payload) as { sessionId: string }).sessionId)
    })
    await listener.query(`LISTEN ${PG_CHANGE_CHANNEL}`)
  })
  afterEach(() => listener.end())

  it('announces the session linked to the written pull request and no other', async () => {
    const { writer } = writerRig()
    await linkSession({ sessionId: 'linked', number: 42 })
    await linkSession({ sessionId: 'elsewhere', number: 43 })
    await settle()
    heard.length = 0
    await write({ writer, checksPassed: 1 })
    await settle()
    expect(heard).toEqual(['linked'])
  })

  it('announces nothing when no session links the pull request', async () => {
    const { writer } = writerRig()
    await linkSession({ sessionId: 'elsewhere', number: 43 })
    await settle()
    heard.length = 0
    await write({ writer, checksPassed: 1 })
    await settle()
    expect(heard).toEqual([])
  })
})
