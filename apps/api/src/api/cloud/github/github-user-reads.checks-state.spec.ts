import { afterEach, describe, expect, it } from 'bun:test'
import { stubGlobal, unstubAllGlobals } from '@dltech/bun-test-shims'
import { EGithubCallSource } from './github-call-log'
import { readChecksState } from './github-checks-state'

const ARGS = {
  source: EGithubCallSource.ChecksState,
  token: 'ghu_1',
  owner: 'compai',
  repo: 'app',
  number: 42,
}

const respondWith = (body: unknown, status = 200) =>
  stubGlobal('fetch', async () => Response.json(body, { status }))

describe('readChecksState', () => {
  afterEach(() => unstubAllGlobals())

  it('lowercases the rollup state GitHub reports', async () => {
    const urls: string[] = []
    stubGlobal('fetch', async (input: URL | string | Request) => {
      urls.push(String(input instanceof Request ? input.url : input))
      return Response.json({
        data: { repository: { pullRequest: { statusCheckRollup: { state: 'EXPECTED' } } } },
      })
    })

    const state = await readChecksState(ARGS)

    expect(state).toBe('expected')
    expect(urls[0]).toBe('https://api.github.com/graphql')
  })

  it('answers null for a non-2xx answer', async () => {
    respondWith({ data: {} }, 500)

    expect(await readChecksState(ARGS)).toBeNull()
  })

  it('answers null for a GraphQL errors payload', async () => {
    respondWith({ errors: [{ message: 'Could not resolve to a Repository' }] })

    expect(await readChecksState(ARGS)).toBeNull()
  })

  it('answers null when GitHub has no rollup or no pull request to report one for', async () => {
    respondWith({ data: { repository: { pullRequest: { statusCheckRollup: null } } } })
    expect(await readChecksState(ARGS)).toBeNull()

    respondWith({ data: { repository: { pullRequest: null } } })
    expect(await readChecksState(ARGS)).toBeNull()
  })

  it('answers null instead of throwing when the request fails', async () => {
    stubGlobal('fetch', async () => {
      throw new Error('socket hang up')
    })

    expect(await readChecksState(ARGS)).toBeNull()
  })
})
