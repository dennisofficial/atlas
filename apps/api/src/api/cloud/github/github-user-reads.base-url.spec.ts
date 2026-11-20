import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { EGithubCallSource } from './github-call-log'
import { GithubUserReads } from './github-user-reads'

const target = { source: EGithubCallSource.Unattributed, token: 't', owner: 'o', repo: 'r' }

describe('GithubUserReads base url', () => {
  const urls: string[] = []
  let restore: () => void

  beforeEach(() => {
    urls.length = 0
    const mock = spyOn(globalThis, 'fetch').mockImplementation((async (input: URL | string) => {
      const url = String(input)
      urls.push(url)
      const path = new URL(url).pathname
      if (path.endsWith('/hooks')) return Response.json({ id: 7 }, { status: 201 })
      if (path.endsWith('/check-runs')) return Response.json({ check_runs: [] })
      if (path.endsWith('/status')) return Response.json({ statuses: [] })
      return Response.json({
        number: 1,
        head: { sha: 'abc', ref: 'b', repo: null },
        base: { ref: 'main' },
      })
    }) as unknown as typeof fetch)
    restore = () => mock.mockRestore()
  })
  afterEach(() => restore())

  it('reads a pull, its checks and its required contexts from api.github.com', async () => {
    await new GithubUserReads().readPullRequest({
      ...target,
      number: 1,
      collectChecks: () => undefined,
    })

    expect(
      urls.some((url) => url.startsWith('https://api.github.com/repos/o/r/rules/branches/')),
    ).toBe(true)
    expect(urls.every((url) => url.startsWith('https://api.github.com/'))).toBe(true)
  })

  it('creates a hook on api.github.com', async () => {
    await new GithubUserReads().createHook({ ...target, config: { url: 'u', secret: 's' } })

    expect(urls).toEqual(['https://api.github.com/repos/o/r/hooks'])
  })
})
