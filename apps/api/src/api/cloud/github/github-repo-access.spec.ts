import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { ForbiddenException, HttpException } from '@nestjs/common'
import { stubGlobal, unstubAllGlobals } from '@dltech/bun-test-shims'
import { advanceTimersByTimeAsync } from '../../../../test/fake-timers'
import { EGithubCallSource } from './github-call-log'
import { RepoAccessChecker } from './github-repo-access'
import { hangingFetch, stubAbortSignalTimeout } from './github-timeout.fakes'

describe('RepoAccessChecker outbound timeout', () => {
  let requestedMs: number[]

  beforeEach(() => {
    vi.useFakeTimers()
    ;({ requestedMs } = stubAbortSignalTimeout())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    unstubAllGlobals()
  })

  const checker = () => new RepoAccessChecker(async () => 'token')
  const args = {
    source: EGithubCallSource.RepoAccess,
    userId: 'u',
    owner: 'o',
    repo: 'r',
  }

  it('rejects with a TimeoutError after 8s when github never answers', async () => {
    stubGlobal('fetch', vi.fn(hangingFetch))
    const settled = checker()
      .require(args)
      .then(
        () => 'resolved',
        (failure: unknown) => failure,
      )

    await advanceTimersByTimeAsync(8_000)

    const outcome = await settled
    expect(outcome).toBeInstanceOf(DOMException)
    expect((outcome as DOMException).name).toBe('TimeoutError')
    expect(requestedMs).toEqual([8_000])
  })

  it('does not cache the timed-out check, so the next call asks github again', async () => {
    stubGlobal('fetch', vi.fn(hangingFetch))
    const subject = checker()
    const first = subject.require(args).catch(() => undefined)
    await advanceTimersByTimeAsync(8_000)
    await first

    stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 })),
    )
    await expect(subject.require(args)).resolves.toBe(true)
  })

  it('sends an abort signal with the request', async () => {
    const answered = vi.fn(async () => new Response('{}', { status: 200 }))
    stubGlobal('fetch', answered)
    await checker().require(args)
    const init = (answered.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('RepoAccessChecker rate limits', () => {
  afterEach(() => unstubAllGlobals())

  const args = {
    source: EGithubCallSource.RepoAccess,
    userId: 'u',
    owner: 'o',
    repo: 'r',
  }
  const answer = (init: ResponseInit) =>
    stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', init)),
    )

  it('turns 403 with an exhausted primary limit into a 429 naming the wait', async () => {
    const reset = Math.floor(Date.now() / 1_000) + 120
    answer({
      status: 403,
      headers: {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(reset),
      },
    })
    const failure = await new RepoAccessChecker(async () => 't')
      .require(args)
      .catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(HttpException)
    expect((failure as HttpException).getStatus()).toBe(429)
    expect((failure as HttpException).message).toMatch(/rate limit.*retry in (119|120|121)s/)
  })

  it('turns 429 with retry-after into a 429', async () => {
    answer({ status: 429, headers: { 'retry-after': '17' } })
    const failure = await new RepoAccessChecker(async () => 't')
      .require(args)
      .catch((e: unknown) => e)
    expect((failure as HttpException).getStatus()).toBe(429)
    expect((failure as HttpException).message).toContain('retry in 17s')
  })

  it('turns a secondary-limit 403 with retry-after into a 429', async () => {
    answer({
      status: 403,
      headers: { 'retry-after': '30', 'x-ratelimit-remaining': '10' },
    })
    const failure = await new RepoAccessChecker(async () => 't')
      .require(args)
      .catch((e: unknown) => e)
    expect((failure as HttpException).getStatus()).toBe(429)
  })

  it('keeps a plain 403 forbidden', async () => {
    answer({ status: 403, headers: { 'x-ratelimit-remaining': '4999' } })
    const failure = await new RepoAccessChecker(async () => 't')
      .require(args)
      .catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(ForbiddenException)
  })

  it('does not cache a rate-limited check', async () => {
    const fetched = vi.fn(async () => new Response('{}', { status: 429 }))
    stubGlobal('fetch', fetched)
    const subject = new RepoAccessChecker(async () => 't')
    await subject.require(args).catch(() => undefined)
    await subject.require(args).catch(() => undefined)
    expect(fetched).toHaveBeenCalledTimes(2)
  })
})
