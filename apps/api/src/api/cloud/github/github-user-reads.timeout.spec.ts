import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GithubUserReads } from './github-user-reads'
import { hangingFetch, stubAbortSignalTimeout } from './github-timeout.fakes'

const target = { token: 't', owner: 'o', repo: 'r' }

describe('GithubUserReads outbound timeouts', () => {
  let reads: GithubUserReads
  let requestedMs: number[]

  beforeEach(() => {
    vi.useFakeTimers()
    ;({ requestedMs } = stubAbortSignalTimeout())
    vi.stubGlobal('fetch', vi.fn(hangingFetch))
    reads = new GithubUserReads()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const calls: Record<string, () => Promise<unknown>> = {
    'get (readPullRequest)': () => reads.readPullRequest({ ...target, number: 1 }),
    createHook: () => reads.createHook({ ...target, config: { url: 'u', secret: 's' } }),
    getHook: () => reads.getHook({ ...target, hookId: 1 }),
    updateHook: () => reads.updateHook({ ...target, hookId: 1, events: [] }),
    deleteHook: () => reads.deleteHook({ ...target, hookId: 1 }),
  }

  it.each(Object.keys(calls))('%s rejects with a TimeoutError instead of hanging', async (name) => {
    const call = calls[name]
    if (call === undefined) throw new Error(`no call for ${name}`)
    const settled = call().then(
      () => 'resolved',
      (failure: unknown) => failure,
    )

    await vi.advanceTimersByTimeAsync(8_000)

    const outcome = await settled
    expect(outcome).toBeInstanceOf(DOMException)
    expect((outcome as DOMException).name).toBe('TimeoutError')
    expect(requestedMs).toEqual([8_000])
  })

  it('does not abort before the timeout elapses', async () => {
    const outcome = vi.fn()
    void reads.getHook({ ...target, hookId: 1 }).catch(outcome)

    await vi.advanceTimersByTimeAsync(7_999)
    expect(outcome).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(outcome).toHaveBeenCalledOnce()
  })

  it('requests the 8s timeout on every outbound call, including the hook lookup', async () => {
    const answered = vi.fn(async () => new Response(JSON.stringify({ id: 1, events: [] }), { status: 200 }))
    vi.stubGlobal('fetch', answered)

    await reads.getHook({ ...target, hookId: 1 })
    await reads.deleteHook({ ...target, hookId: 1 })
    await reads.updateHook({ ...target, hookId: 1, events: [] })
    await reads.createHook({ ...target, config: { url: 'u', secret: 's' } })
    await reads.getHookEvents({ ...target, hookId: 1 })

    expect(answered).toHaveBeenCalledTimes(5)
    expect(requestedMs).toEqual([8_000, 8_000, 8_000, 8_000, 8_000])
    for (const [, init] of answered.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(init.signal).toBeInstanceOf(AbortSignal)
    }
  })
})
