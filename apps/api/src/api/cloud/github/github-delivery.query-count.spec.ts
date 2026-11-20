import { countQueries, useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { seedPrState } from '../../../../test/github-seed'
import {
  FILLED_PR_STATE,
  REST_FIELDS,
  checkRunPayload,
  prepareDelivery,
  seedHook,
  seedSubscription,
  serviceWith,
} from './github-delivery.fixture'

const countedDelivery = async (args: {
  seed: () => Promise<unknown>
}): Promise<{ statements: string[] }> => {
  const { service } = serviceWith({
    tokens: { 'usr-creator': 'ghu_creator' },
    readPullRequest: async () => REST_FIELDS,
    readCheckAnnotations: async () => [],
  })
  await seedHook({ createdBy: 'usr-creator' })
  await args.seed()
  const counter = countQueries()
  await service.handle({ event: 'check_run', payload: checkRunPayload() })
  return { statements: counter.stop() }
}

const report = (label: string, statements: readonly string[]): void => {
  const lines = statements.map(
    (statement, index) => `${index + 1}. ${statement.replace(/\s+/g, ' ').slice(0, 140)}`,
  )
  console.log(`[query-count] ${label}: ${statements.length} statements\n${lines.join('\n')}`)
}

describe('one check_run delivery', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

  it('reaches a skip for a delivery nobody watches in one statement', async () => {
    const { statements } = await countedDelivery({
      seed: async () => {
        const readPullRequest = vi.fn(async () => REST_FIELDS)
        return readPullRequest.mock.calls.length
      },
    })
    report('unwatched', statements)

    expect(statements).toHaveLength(1)
    expect(statements[0]).toContain('FROM "GithubSubscription"')
  })

  it('counts the statements a delivery one live subscription watches issues', async () => {
    const { statements } = await countedDelivery({
      seed: async () => {
        await seedSubscription({ userId: 'usr-a', prNumber: 42 })
        await seedPrState({
          ...FILLED_PR_STATE,
          checksRunning: 0,
          checksPassed: 0,
          mergeable: null,
        })
      },
    })
    report('one live subscription', statements)

    expect(statements).toHaveLength(39)
    expect(statements[0]).toContain('FROM "GithubSubscription"')
  })
})
