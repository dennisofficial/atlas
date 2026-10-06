import { describe, expect, it } from 'bun:test'

import { withQualityDeadline } from '../deadline'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('withQualityDeadline', () => {
  it('returns the completed value and clears its timer', async () => {
    const result = await withQualityDeadline({ signal: new AbortController().signal, deadlineMs: 50, work: async () => 7 })
    expect(result).toEqual({ kind: 'completed', value: 7 })
  })

  it('settles as deadline when the work ignores its signal, discarding the late resolution', async () => {
    let inner: AbortSignal | undefined
    const result = await withQualityDeadline({
      signal: new AbortController().signal,
      deadlineMs: 15,
      work: async (signal) => {
        inner = signal
        await sleep(60)
        return 'late'
      },
    })
    expect(result).toEqual({ kind: 'deadline' })
    expect(inner?.aborted).toBe(true)
    await sleep(70)
  })

  it('settles as aborted when the caller signal fires and aborts the inner signal', async () => {
    const caller = new AbortController()
    let inner: AbortSignal | undefined
    const pending = withQualityDeadline({
      signal: caller.signal,
      deadlineMs: 500,
      work: (signal) => {
        inner = signal
        return new Promise<never>(() => {})
      },
    })
    caller.abort()
    expect(await pending).toEqual({ kind: 'aborted' })
    expect(inner?.aborted).toBe(true)
  })

  it('does not start work when the caller is already aborted', async () => {
    const caller = new AbortController()
    caller.abort()
    let started = false
    const result = await withQualityDeadline({
      signal: caller.signal,
      deadlineMs: 50,
      work: async () => {
        started = true
        return 1
      },
    })
    expect(result).toEqual({ kind: 'aborted' })
    expect(started).toBe(false)
  })

  it('reports a rejection as failed', async () => {
    const result = await withQualityDeadline({
      signal: new AbortController().signal,
      deadlineMs: 50,
      work: async () => {
        throw new Error('boom')
      },
    })
    expect(result.kind).toBe('failed')
  })
})
