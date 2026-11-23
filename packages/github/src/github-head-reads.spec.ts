import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'

import { GithubHeadReads } from './github-head-reads'

describe('GithubHeadReads', () => {
  const urls: string[] = []
  let restore: () => void

  beforeEach(() => {
    urls.length = 0
    const mock = spyOn(globalThis, 'fetch').mockImplementation((async (input: URL | string) => {
      urls.push(String(input))
      return Response.json([])
    }) as unknown as typeof fetch)
    restore = () => mock.mockRestore()
  })
  afterEach(() => restore())

  it('qualifies the head with the fork owner on the parent query', async () => {
    const reads = new GithubHeadReads()
    await reads.pullsByHead({
      token: 'ghu_1',
      repoFullName: 'compai/app',
      headRepoFullName: 'dennis/fork',
      branch: 'dennis/feature',
    })

    expect(urls).toEqual([
      'https://api.github.com/repos/compai/app/pulls?state=all&head=dennis:dennis%2Ffeature&per_page=100',
    ])
  })
})
