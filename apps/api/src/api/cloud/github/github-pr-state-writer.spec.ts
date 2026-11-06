import { Logger } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
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
