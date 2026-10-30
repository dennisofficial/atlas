import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { createApiClient } from '@dltech/atlas-api-router'

import * as realApiClient from '@/lib/api-client'

let urls: string[]

const fakeFetch = Object.assign(
  async (input: Parameters<typeof fetch>[0]) => {
    urls.push(String(input))
    return Response.json({
      result: { data: { names: ['decisions.token.typesafe', 'search.tavily'] } },
    })
  },
  { preconnect: fetch.preconnect },
)

mock.module('@/lib/api-client', () => ({
  ...realApiClient,
  api: createApiClient({ baseUrl: '', fetchFn: fakeFetch }),
}))

const { loadSecretNames } = await import('../use-agent-keys')

beforeEach(() => {
  urls = []
})

describe('agent key names', () => {
  it('learns saved key names from harnessSecrets.names and never calls secrets.*', async () => {
    const names = await loadSecretNames()

    expect([...names]).toEqual(['decisions.token.typesafe', 'search.tavily'])
    expect(urls.some((url) => url.includes('harnessSecrets.names'))).toBe(true)
    expect(urls.some((url) => /\/secrets\./.test(url))).toBe(false)
  })
})
