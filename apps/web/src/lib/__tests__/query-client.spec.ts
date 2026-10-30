import { describe, expect, it } from 'bun:test'

import { CloudApiError } from '../cloud-api'
import { createQueryClient, shouldRetry } from '../query-client'

describe('shouldRetry', () => {
  it('retries a 5xx once and never a 4xx', () => {
    const server = new CloudApiError({ message: 'x', status: 502 })
    const client = new CloudApiError({ message: 'x', status: 404 })

    expect(shouldRetry(0, server)).toBe(true)
    expect(shouldRetry(1, server)).toBe(false)
    expect(shouldRetry(0, client)).toBe(false)
  })
})

describe('cache invalidation', () => {
  it('marks a cached key stale so the next observer refetches', async () => {
    const client = createQueryClient()
    client.setQueryData(['projects'], { value: [] })

    await client.invalidateQueries({ queryKey: ['projects'] })

    expect(client.getQueryState(['projects'])?.isInvalidated).toBe(true)
  })
})

describe('clearCloudCache', () => {
  it('is a no-op before any browser client exists', async () => {
    const { clearCloudCache } = await import('../query-client')

    expect(() => clearCloudCache()).not.toThrow()
  })
})
