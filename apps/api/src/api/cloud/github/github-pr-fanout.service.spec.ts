import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  mergeable: true,
  updatedAt: '2026-09-28T00:00:00.000Z',
}

function fanoutWith(): { fanout: GithubPrFanoutService; drain: DrainStateService } {
  const drain = new DrainStateService()
  return { fanout: new GithubPrFanoutService(drain), drain }
}

describe('GithubPrFanoutService', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('delivers a push to every open stream of the addressed users', async () => {
    const { fanout } = fanoutWith()
    const receivedA: GithubPrStateDto[] = []
    const receivedB: GithubPrStateDto[] = []
    fanout.openStream({ userId: 'usr_a', handler: (state) => receivedA.push(state) })
    fanout.openStream({ userId: 'usr_a', handler: (state) => receivedA.push(state) })
    fanout.openStream({ userId: 'usr_b', handler: (state) => receivedB.push(state) })

    fanout.push({ userIds: ['usr_a'], state: STATE })
    await vi.advanceTimersByTimeAsync(1_100)

    expect(receivedA).toHaveLength(2)
    expect(receivedB).toHaveLength(0)
  })

  it('flushes the first push immediately, then coalesces the window to the latest state', async () => {
    const { fanout } = fanoutWith()
    const received: GithubPrStateDto[] = []
    fanout.openStream({ userId: 'usr_a', handler: (state) => received.push(state) })

    fanout.push({ userIds: ['usr_a'], state: { ...STATE, checksRunning: 1 } })
    expect(received).toHaveLength(1)
    expect(received[0]?.checksRunning).toBe(1)

    fanout.push({ userIds: ['usr_a'], state: { ...STATE, checksRunning: 2 } })
    fanout.push({ userIds: ['usr_a'], state: { ...STATE, checksRunning: 3 } })
    await vi.advanceTimersByTimeAsync(1_100)

    expect(received).toHaveLength(2)
    expect(received[1]?.checksRunning).toBe(3)
  })

  it('delivers immediately again once the coalesce window has closed', async () => {
    const { fanout } = fanoutWith()
    const received: GithubPrStateDto[] = []
    fanout.openStream({ userId: 'usr_a', handler: (state) => received.push(state) })

    fanout.push({ userIds: ['usr_a'], state: { ...STATE, checksRunning: 1 } })
    await vi.advanceTimersByTimeAsync(1_100)
    fanout.push({ userIds: ['usr_a'], state: { ...STATE, checksRunning: 0, checksPassed: 4 } })

    expect(received).toHaveLength(2)
    expect(received[1]?.checksPassed).toBe(4)
  })

  it('stops delivering after the stream closes', async () => {
    const { fanout } = fanoutWith()
    const received: GithubPrStateDto[] = []
    const close = fanout.openStream({ userId: 'usr_a', handler: (state) => received.push(state) })

    close()
    fanout.push({ userIds: ['usr_a'], state: STATE })
    await vi.advanceTimersByTimeAsync(1_100)

    expect(received).toHaveLength(0)
  })

  it('a throwing handler does not take down the other streams', async () => {
    const { fanout } = fanoutWith()
    const received: GithubPrStateDto[] = []
    fanout.openStream({
      userId: 'usr_a',
      handler: () => {
        throw new Error('dead stream')
      },
    })
    fanout.openStream({ userId: 'usr_a', handler: (state) => received.push(state) })

    fanout.push({ userIds: ['usr_a'], state: STATE })
    await vi.advanceTimersByTimeAsync(1_100)

    expect(received).toHaveLength(1)
  })

  it('closeAll drops a pending coalesced push and closes only streams with a close hook', async () => {
    const { fanout } = fanoutWith()
    const closed: string[] = []
    fanout.openStream({
      userId: 'usr_a',
      handler: () => {},
      onClosed: () => closed.push('usr_a'),
    })
    fanout.openStream({ userId: 'usr_b', handler: () => {} })

    fanout.push({ userIds: ['usr_a'], state: { ...STATE, checksRunning: 1 } })
    fanout.push({ userIds: ['usr_a'], state: { ...STATE, checksRunning: 2 } })
    fanout.closeAll()
    await vi.advanceTimersByTimeAsync(1_100)

    expect(closed).toEqual(['usr_a'])
  })

  it('beginDrain closes every open stream through its onClosed hook', async () => {
    const { fanout, drain } = fanoutWith()
    const closed: string[] = []
    const received: GithubPrStateDto[] = []
    fanout.openStream({
      userId: 'usr_a',
      handler: (state) => received.push(state),
      onClosed: () => closed.push('a1'),
    })
    fanout.openStream({
      userId: 'usr_b',
      handler: (state) => received.push(state),
      onClosed: () => closed.push('b1'),
    })

    drain.beginDrain()
    fanout.push({ userIds: ['usr_a', 'usr_b'], state: STATE })
    await vi.advanceTimersByTimeAsync(1_100)

    expect(closed).toEqual(['a1', 'b1'])
    expect(received).toHaveLength(0)
  })

  it('a throwing onClosed hook does not take down the remaining closes', () => {
    const { fanout } = fanoutWith()
    const closed: string[] = []
    fanout.openStream({
      userId: 'usr_a',
      handler: () => {},
      onClosed: () => {
        throw new Error('half-closed socket')
      },
    })
    fanout.openStream({
      userId: 'usr_a',
      handler: () => {},
      onClosed: () => closed.push('still closed'),
    })

    expect(() => fanout.closeAll()).not.toThrow()
    expect(closed).toEqual(['still closed'])
  })
})
