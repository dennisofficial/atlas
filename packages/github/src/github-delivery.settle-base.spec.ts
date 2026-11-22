import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { prStateRows } from './testing/github-seed'
import { setupTrackedPr } from './github-delivery.checks.fixture'
import { REST_FIELDS, checkRunPayload, prepareDelivery } from './github-delivery.fixture'

describe('GithubDeliveryService settle confirmation', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

  it('scopes the settle mergeability to the base the REST pull read, not the stored one', async () => {
    const readPullRequest = vi.fn(async (args: unknown) => {
      const { collectRequiredContexts } = args as {
        collectRequiredContexts?: (held: {
          acquiredAt: Date
          baseBranch: string
          requiredContexts: string[]
        }) => void
      }
      collectRequiredContexts?.({
        acquiredAt: new Date(),
        baseBranch: 'release',
        requiredContexts: [],
      })
      return { ...REST_FIELDS, checksRunning: 0, checksPassed: 1, mergeable: true }
    })
    const { service } = await setupTrackedPr(readPullRequest)

    await service.handle({ event: 'check_run', payload: checkRunPayload({ id: 1 }) })

    expect(readPullRequest).toHaveBeenCalledTimes(1)
    expect((await prStateRows())[0]).toMatchObject({ baseBranch: 'main', mergeable: null })
  })
})
