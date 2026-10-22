import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { prEventRows } from '../../../../test/github-seed'
import {
  preparePollSweeper,
  REST_FIELDS,
  seedPrState,
  seedSubscription,
  serviceWith,
} from './github-poll-sweeper.fixture'

describe('GithubPollSweeperService transition events', () => {
  useTestDatabase()

  beforeEach(preparePollSweeper)

  it('records a merged state event when a poll-backed read first reports merged', async () => {
    const readPullRequest = vi.fn(async () => ({ ...REST_FIELDS, state: 'merged' }))
    const { service } = serviceWith({ tokens: { 'usr_1': 'ghu_1' }, readPullRequest })
    await seedSubscription()
    await seedPrState({ state: 'open' })

    await service.handlePoll()

    const states = (await prEventRows()).filter((row) => row.kind === 'state')
    expect(states).toHaveLength(1)
    expect(states[0]).toMatchObject({
      userId: 'usr_1',
      prNumber: 42,
      payload: { state: 'merged', url: 'https://github.com/compai/app/pull/42' },
    })
  })

  it('records a green verdict when a poll-backed read settles passing after running', async () => {
    const readPullRequest = vi.fn(async () => ({
      ...REST_FIELDS,
      checksRunning: 0,
      checksPassed: 3,
      checksFailed: 0,
      mergeable: true,
    }))
    const { service } = serviceWith({ tokens: { 'usr_1': 'ghu_1' }, readPullRequest })
    await seedSubscription()
    await seedPrState({ checksRunning: 2, checksPassed: 1, checksFailed: 0 })

    await service.handlePoll()

    const verdicts = (await prEventRows()).filter((row) => row.kind === 'verdict')
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toMatchObject({ payload: { verdict: 'green' } })
  })

  it('records no event on a steady-state re-read of a poll-backed pr', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: { 'usr_1': 'ghu_1' }, readPullRequest })
    await seedSubscription()
    await seedPrState()

    await service.handlePoll()

    expect(await prEventRows()).toHaveLength(0)
  })

  it('records no event when a poll-backed pr row is brand new', async () => {
    const readPullRequest = vi.fn(async () => ({ ...REST_FIELDS, state: 'merged' }))
    const { service } = serviceWith({ tokens: { 'usr_1': 'ghu_1' }, readPullRequest })
    await seedSubscription()

    await service.handlePoll()

    expect(await prEventRows()).toHaveLength(0)
  })
})
