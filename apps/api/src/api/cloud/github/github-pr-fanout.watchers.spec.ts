import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { advanceTimersByTimeAsync } from '../../../../test/fake-timers'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import type { GithubPrStateDto } from './github-realtime.types'

const STATE: GithubPrStateDto = {
  repoFullName: 'compai/app',
  prNumber: 42,
  title: 'add the thing',
  url: 'https://github.com/compai/app/pull/42',
  state: 'open',
  headBranch: 'dennis/add-the-thing',
  headSha: 'abc123',
  checksRunning: 0,
  checksPassed: 3,
  checksFailed: 0,
  checksIgnored: 0,
  checksState: null,
  mergeable: true,
  version: 1,
  updatedAt: '2026-09-28T00:00:00.000Z',
}

function fanoutWith(): { fanout: GithubPrFanoutService; drain: DrainStateService } {
  const drain = new DrainStateService()
  return { fanout: new GithubPrFanoutService(drain), drain }
}

describe('GithubPrFanoutService key watchers', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('delivers a state frame with no addressed users to the watchers of its pr key', async () => {
    const { fanout } = fanoutWith()
    const received: GithubPrStateDto[] = []
    const watch = fanout.watchPrKeys({ handler: (state) => received.push(state) })
    watch.setKeys(['compai/app#42', 'compai/app#7'])

    fanout.push({ userIds: [], state: STATE })
    await advanceTimersByTimeAsync(1_100)

    expect(received).toHaveLength(1)
    expect(received[0]?.prNumber).toBe(42)
  })

  it('setKeys replaces the watched keys', async () => {
    const { fanout } = fanoutWith()
    const received: GithubPrStateDto[] = []
    const watch = fanout.watchPrKeys({ handler: (state) => received.push(state) })
    watch.setKeys(['compai/app#7'])
    watch.setKeys(['compai/app#42'])

    fanout.push({ userIds: [], state: { ...STATE, prNumber: 7 } })
    await advanceTimersByTimeAsync(1_100)
    expect(received).toHaveLength(0)

    fanout.push({ userIds: [], state: STATE })
    await advanceTimersByTimeAsync(1_100)
    expect(received).toHaveLength(1)
  })

  it('a stream that is both addressed and watching a pr receives one frame', async () => {
    const { fanout } = fanoutWith()
    const received: GithubPrStateDto[] = []
    const handler = (state: GithubPrStateDto) => received.push(state)
    fanout.openStream({ userId: 'usr_a', handler })
    const watch = fanout.watchPrKeys({ handler })
    watch.setKeys(['compai/app#42'])

    fanout.push({ userIds: ['usr_a'], state: STATE })
    await advanceTimersByTimeAsync(1_100)

    expect(received).toHaveLength(1)
  })

  it('a closed key watcher receives nothing and stops holding its keys', async () => {
    const { fanout } = fanoutWith()
    const received: GithubPrStateDto[] = []
    const watch = fanout.watchPrKeys({ handler: (state) => received.push(state) })
    watch.setKeys(['compai/app#42'])
    watch.close()

    fanout.push({ userIds: [], state: STATE })
    await advanceTimersByTimeAsync(1_100)

    expect(received).toHaveLength(0)
  })

  it('closeAll closes key watchers through their onClosed hook', () => {
    const { fanout } = fanoutWith()
    const closed: string[] = []
    fanout.watchPrKeys({ handler: () => {}, onClosed: () => closed.push('watch') })

    fanout.closeAll()

    expect(closed).toEqual(['watch'])
  })
})
