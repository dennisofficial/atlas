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
  let branch = 'main'

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
        base: { ref: branch },
      })
    }) as unknown as typeof fetch)
    restore = () => mock.mockRestore()
  })
  afterEach(() => restore())

  it("reads the pull, its head checks and the base branch's required contexts", async () => {
    branch = 'main'
    await new GithubUserReads().readPullRequest({
      ...target,
      number: 1,
      collectChecks: () => undefined,
    })
    expect(paths).toHaveLength(5)
    expect(paths.some((path) => path.endsWith('/graphql'))).toBe(false)
    expect(paths.some((path) => path.includes('/rules/branches/'))).toBe(true)
  })

  it('hands the head checks and the branch protection to their collectors', async () => {
    branch = 'release'
    const collected: Array<{ headSha: string; checks: unknown[]; mergeability?: unknown }> = []
    const protection: unknown[] = []
    await new GithubUserReads().readPullRequest({
      ...target,
      number: 1,
      collectChecks: (read) => collected.push(read),
      collectRequiredContexts: (read) => protection.push(read),
    })
    expect(paths).toHaveLength(5)
    expect(collected).toEqual([
      {
        headSha: 'abc',
        checks: [],
        mergeability: {
          headSha: 'abc',
          baseBranch: 'release',
          mergeable: undefined,
          mergeClean: false,
          observedAt: expect.any(String),
        },
      },
    ])
    expect(protection).toEqual([
      { acquiredAt: expect.any(Date), baseBranch: 'release', requiredContexts: [] },
    ])
  })
})
