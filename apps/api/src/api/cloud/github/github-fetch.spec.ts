import { afterAll, afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
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

const fakeGithub = Bun.serve({
  port: 0,
  fetch: (request) => {
    const path = new URL(request.url).pathname
    if (path === '/hang') return new Promise<Response>(() => undefined)
    if (path === '/rated') return new Response('{"secret":"body"}', { headers: rateHeaders })
    return new Response('{}')
  },
})

const urlOf = (path: string): string => `http://localhost:${fakeGithub.port}${path}`

function captureLines(): string[] {
  const lines: string[] = []
  spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
    lines.push(String(message))
  })
  return lines
}

describe('githubFetch', () => {
  afterEach(() => {
    mock.restore()
  })

  afterAll(() => {
    fakeGithub.stop(true)
  })

  it('logs one json line with rate headers and the ambient source', async () => {
    const lines = captureLines()
    await withGithubCallSource({
      source: EGithubCallSource.PollSweep,
      run: () =>
        githubFetch(urlOf('/rated?state=open'), {
          method: 'POST',
          headers: { authorization: 'Bearer ghp_supersecret' },
        }),
    })
    expect(lines).toHaveLength(1)
    const line = JSON.parse(lines[0] ?? '')
    expect(line).toMatchObject({
      source: 'poll-sweep',
      method: 'POST',
      path: '/rated?state=open',
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
    await withGithubCallSource({
      source: EGithubCallSource.PollSweep,
      run: () =>
        withGithubCallSource({
          source: EGithubCallSource.RepoAccess,
          run: () => githubFetch(urlOf('/user')),
        }),
    })
    await githubFetch(urlOf('/user'))
    expect(JSON.parse(lines[0] ?? '').source).toBe('repo-access')
    expect(JSON.parse(lines[1] ?? '').source).toBe('unattributed')
    expect(JSON.parse(lines[1] ?? '').rateRemaining).toBeNull()
  })

  it('logs an error status and rethrows', async () => {
    const lines = captureLines()
    const attempt = githubFetch(urlOf('/hang'), { signal: AbortSignal.timeout(20) })
    await expect(attempt).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      status: 'error',
      error: 'TimeoutError',
    })
  })
})
