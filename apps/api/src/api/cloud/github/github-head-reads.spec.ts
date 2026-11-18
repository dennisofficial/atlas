import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { GithubHeadReads } from './github-head-reads'

const requests: string[] = []
const prior = process.env.GITHUB_API_URL

const fakeGitHub = Bun.serve({
  port: 0,
  fetch: (request) => {
    const url = new URL(request.url)
    requests.push(`${url.pathname}${url.search}`)
    return new Response('[]', { headers: { 'content-type': 'application/json' } })
  },
})

beforeAll(() => {
  process.env.GITHUB_API_URL = `http://127.0.0.1:${fakeGitHub.port}`
})

afterAll(() => {
  if (prior === undefined) delete process.env.GITHUB_API_URL
  else process.env.GITHUB_API_URL = prior
  fakeGitHub.stop(true)
})

describe('GithubHeadReads', () => {
  it('qualifies the head with the fork owner on the parent query', async () => {
    const reads = new GithubHeadReads()
    await reads.pullsByHead({
      token: 'ghu_1',
      repoFullName: 'compai/app',
      headRepoFullName: 'dennis/fork',
      branch: 'dennis/feature',
    })

    expect(requests).toEqual([
      '/repos/compai/app/pulls?state=all&head=dennis:dennis%2Ffeature&per_page=100',
    ])
  })
})
