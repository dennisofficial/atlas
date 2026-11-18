import { afterAll, afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { Logger } from '@nestjs/common'
import { EGithubCallSource } from './github-call-log'
import { githubFetch } from './github-fetch'
import {
  credentialFingerprint,
  withGithubRequestBudget,
  type GithubHttpBudget,
} from './github-request-budget'

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
    if (path === '/low')
      return new Response('{}', {
        headers: {
          ...rateHeaders,
          'x-ratelimit-limit': '60',
          'x-ratelimit-used': '58',
          'x-ratelimit-remaining': '2',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1_000) + 120),
        },
      })
    if (path === '/secondary')
      return new Response('{"message":"You have exceeded a secondary rate limit."}', {
        status: 403,
        headers: { 'x-ratelimit-resource': 'core', 'x-ratelimit-remaining': '40' },
      })
    if (path === '/repos/expired/app/pulls/1') return new Response('{}', { status: 401 })
    if (path === '/repos/private/app/pulls/1') return new Response('{}', { status: 404 })
    if (path === '/repos/hidden/app/pulls/1')
      return new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '4999' } })
    if (path === '/repos/limited/app/pulls/1')
      return new Response('{}', {
        status: 403,
        headers: { 'retry-after': '30', 'x-ratelimit-remaining': '10' },
      })
    return new Response('{}')
  },
})

const urlOf = (path: string): string => `http://localhost:${fakeGithub.port}${path}`

type Revocation = { credentialFingerprint: string; repoFullName?: string | undefined }

const recordingBudget = (): {
  budget: GithubHttpBudget
  blocked: number[]
  reserved: number[]
  revoked: Revocation[]
} => {
  const blocked: number[] = []
  const reserved: number[] = []
  const revoked: Revocation[] = []
  return {
    blocked,
    reserved,
    revoked,
    budget: {
      revokeAccessGrant: async (args) => {
        revoked.push(args)
      },
      takeHttpSlot: async () => true,
      httpCooldownUntil: async () => 0,
      httpReserveUntil: async () => 0,
      blockHttpUntil: async (args) => {
        blocked.push(args.until)
      },
      holdHttpReserve: async (args) => {
        reserved.push(args.until)
      },
    },
  }
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
    mock.restore()
  })

  afterAll(() => {
    fakeGithub.stop(true)
  })

  it('logs one json line with rate headers and the given source', async () => {
    const lines = captureLines()
    await githubFetch({
      source: EGithubCallSource.PollSweep,
      url: urlOf('/rated?state=open'),
      init: { method: 'POST', headers: { authorization: 'Bearer ghp_supersecret' } },
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

  it('logs the explicitly given source and null rate headers when absent', async () => {
    const lines = captureLines()
    await githubFetch({ source: EGithubCallSource.RepoAccess, url: urlOf('/user') })
    expect(JSON.parse(lines[0] ?? '').source).toBe('repo-access')
    expect(JSON.parse(lines[0] ?? '').rateRemaining).toBeNull()
  })

  it('names the credential fingerprint and its kind without logging the token', async () => {
    const lines = captureLines()
    await githubFetch({
      source: EGithubCallSource.DeliveryFill,
      url: urlOf('/rated'),
      init: { headers: { authorization: 'Bearer ghs_installation' } },
    })
    await githubFetch({
      source: EGithubCallSource.RepoList,
      url: urlOf('/rated'),
      init: { headers: { authorization: 'Bearer gho_user' } },
    })
    const installation = JSON.parse(lines[0] ?? '')
    const user = JSON.parse(lines[1] ?? '')
    expect(installation.credentialKind).toBe('installation')
    expect(user.credentialKind).toBe('user')
    expect(installation.credentialFingerprint).toBeString()
    expect(installation.credentialFingerprint).not.toBe(user.credentialFingerprint)
    expect(lines.join('')).not.toContain('ghs_installation')
    expect(lines.join('')).not.toContain('gho_user')
  })

  it('feeds a low remaining header back as a reserve on the credential', async () => {
    captureLines()
    const { budget, reserved } = recordingBudget()
    await withGithubRequestBudget({
      store: budget,
      run: () =>
        githubFetch({
          source: EGithubCallSource.PollSweep,
          url: urlOf('/low'),
          init: { headers: { authorization: 'Bearer gho_user' } },
        }),
    })
    expect(reserved).toHaveLength(1)
    expect((reserved[0] ?? 0) - Date.now()).toBeGreaterThan(100_000)
  })

  it('treats a 403 secondary rate limit as a cooldown even with remaining quota', async () => {
    captureLines()
    const { budget, blocked } = recordingBudget()
    await withGithubRequestBudget({
      store: budget,
      run: () =>
        githubFetch({
          source: EGithubCallSource.PollSweep,
          url: urlOf('/secondary'),
          init: { headers: { authorization: 'Bearer gho_user' } },
        }),
    })
    expect(blocked).toHaveLength(1)
    expect((blocked[0] ?? 0) - Date.now()).toBeGreaterThan(59_000)
    expect((blocked[0] ?? 0) - Date.now()).toBeLessThanOrEqual(60_000)
  })

  it('drops every grant of the credential when github rejects the user token', async () => {
    captureLines()
    const { budget, revoked } = recordingBudget()
    await withGithubRequestBudget({
      store: budget,
      run: () =>
        githubFetch({
          source: EGithubCallSource.SubscriptionResolve,
          url: urlOf('/repos/expired/app/pulls/1'),
          init: { headers: { authorization: 'Bearer ghu_expired' } },
        }),
    })
    expect(revoked).toEqual([{ credentialFingerprint: credentialFingerprint('ghu_expired') }])
  })

  it('drops only that repository grant on a repo 403 or 404', async () => {
    captureLines()
    const { budget, revoked } = recordingBudget()
    const call = (path: string) =>
      withGithubRequestBudget({
        store: budget,
        run: () =>
          githubFetch({
            source: EGithubCallSource.SubscriptionResolve,
            url: urlOf(path),
            init: { headers: { authorization: 'Bearer ghu_owner' } },
          }),
      })
    await call('/repos/private/app/pulls/1')
    await call('/repos/hidden/app/pulls/1')
    await call('/repos/limited/app/pulls/1')
    expect(revoked).toEqual([
      { credentialFingerprint: credentialFingerprint('ghu_owner'), repoFullName: 'private/app' },
      { credentialFingerprint: credentialFingerprint('ghu_owner'), repoFullName: 'hidden/app' },
    ])
  })

  it('logs an error status and rethrows', async () => {
    const lines = captureLines()
    const attempt = githubFetch({
      source: EGithubCallSource.Unattributed,
      url: urlOf('/hang'),
      init: { signal: AbortSignal.timeout(20) },
    })
    await expect(attempt).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      status: 'error',
      error: 'TimeoutError',
    })
  })
})
