import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { Logger } from '@nestjs/common'
import { EGithubCallSource, withGithubCallSource } from './github-call-log'
import { githubFetch } from './github-fetch'

const rateHeaders = {
  'x-ratelimit-resource': 'core',
  'x-ratelimit-used': '7',
  'x-ratelimit-remaining': '4993',
  'x-ratelimit-limit': '5000',
  'x-ratelimit-reset': '1700000000',
}

function captureLines(): string[] {
  const lines: string[] = []
  spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
    lines.push(String(message))
  })
  return lines
}

describe('githubFetch', () => {
  afterEach(() => {
    spyOn(globalThis, 'fetch').mockRestore()
    spyOn(Logger.prototype, 'log').mockRestore()
  })

  it('logs one json line with rate headers and the ambient source', async () => {
    const lines = captureLines()
    spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"secret":"body"}', { headers: rateHeaders }),
    )
    await withGithubCallSource({
      source: EGithubCallSource.PollSweep,
      run: () =>
        githubFetch('https://api.github.com/repos/a/b/pulls?state=open', {
          method: 'POST',
          headers: { authorization: 'Bearer ghp_supersecret' },
        }),
    })
    expect(lines).toHaveLength(1)
    const line = JSON.parse(lines[0] ?? '')
    expect(line).toMatchObject({
      source: 'poll-sweep',
      method: 'POST',
      path: '/repos/a/b/pulls?state=open',
      status: 200,
      rateResource: 'core',
      rateUsed: 7,
      rateRemaining: 4993,
      rateLimit: 5000,
      rateReset: 1700000000,
    })
    expect(typeof line.durationMs).toBe('number')
    expect(lines[0]).not.toContain('ghp_supersecret')
    expect(lines[0]).not.toContain('body')
  })

  it('lets a nested source win and falls back to unattributed', async () => {
    const lines = captureLines()
    spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    await withGithubCallSource({
      source: EGithubCallSource.PollSweep,
      run: () =>
        withGithubCallSource({
          source: EGithubCallSource.RepoAccess,
          run: () => githubFetch('https://api.github.com/user'),
        }),
    })
    await githubFetch('https://api.github.com/user')
    expect(JSON.parse(lines[0] ?? '').source).toBe('repo-access')
    expect(JSON.parse(lines[1] ?? '').source).toBe('unattributed')
    expect(JSON.parse(lines[1] ?? '').rateRemaining).toBeNull()
  })

  it('logs an error status and rethrows', async () => {
    const lines = captureLines()
    const failure = new DOMException('timed out', 'TimeoutError')
    spyOn(globalThis, 'fetch').mockRejectedValue(failure)
    await expect(githubFetch('https://api.github.com/user')).rejects.toBe(failure)
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      status: 'error',
      error: 'TimeoutError',
    })
  })
})
