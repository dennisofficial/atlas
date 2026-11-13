import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { EGithubCallSource } from './github-call-log'
import { GithubUserReads } from './github-user-reads'

const target = {
  source: EGithubCallSource.Unattributed,
  token: 't',
  owner: 'o',
  repo: 'r',
}

describe('GithubUserReads settle confirmation', () => {
  const paths: string[] = []
  let restore: () => void

  beforeEach(() => {
    paths.length = 0
    const mock = spyOn(globalThis, 'fetch').mockImplementation((async (input: URL | string) => {
      const path = new URL(String(input)).pathname
      paths.push(path)
      if (path.endsWith('/check-runs')) return Response.json({ check_runs: [] })
      if (path.endsWith('/status')) return Response.json({ statuses: [] })
      return Response.json({
        number: 1,
        head: { sha: 'abc', ref: 'b', repo: null },
      })
    }) as unknown as typeof fetch)
    restore = () => mock.mockRestore()
  })
  afterEach(() => restore())

  it('reads the pull, its check-runs, its statuses and GitHub rollup state', async () => {
    await new GithubUserReads().readPullRequest({
      ...target,
      number: 1,
      collectChecks: () => undefined,
    })
    expect(paths).toHaveLength(4)
    expect(paths.some((path) => path.endsWith('/graphql'))).toBe(true)
  })

  it('makes the same four calls whether or not the caller collects checks', async () => {
    await new GithubUserReads().readPullRequest({ ...target, number: 1 })
    expect(paths).toHaveLength(4)
  })
})
