import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
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
  const args = { source: EGithubCallSource.RepoAccess, userId: 'u', owner: 'o', repo: 'r' }

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
