import { describe, expect, it } from 'bun:test'

import { fetchArchiveWithRetry } from '../context-archive-retry'

const instantSleep = (slept: number[]): ((ms: number) => Promise<void>) =>
  async (ms) => void slept.push(ms)

describe('fetchArchiveWithRetry', () => {
  it('returns the archive on the first call without sleeping', async () => {
    const archive = new Uint8Array([1, 2, 3])
    const slept: number[] = []

    const result = await fetchArchiveWithRetry({
      fetchArchive: async () => archive,
      retry: { sleep: instantSleep(slept) },
    })

    expect(result).toBe(archive)
    expect(slept).toEqual([])
  })

  it('retries a 404 on the given schedule until the archive lands', async () => {
    const archive = new Uint8Array([9])
    let calls = 0
    const slept: number[] = []

    const result = await fetchArchiveWithRetry({
      fetchArchive: async () => {
        calls += 1
        return calls < 3 ? null : archive
      },
      retry: { attempts: 5, intervalMs: 3_000, sleep: instantSleep(slept) },
    })

    expect(result).toBe(archive)
    expect(calls).toBe(3)
    expect(slept).toEqual([3_000, 3_000])
  })

  it('gives up and returns null once the attempt bound is exhausted', async () => {
    let calls = 0
    const slept: number[] = []

    const result = await fetchArchiveWithRetry({
      fetchArchive: async () => {
        calls += 1
        return null
      },
      retry: { attempts: 4, intervalMs: 1_000, sleep: instantSleep(slept) },
    })

    expect(result).toBeNull()
    expect(calls).toBe(4)
    expect(slept).toEqual([1_000, 1_000, 1_000])
  })

  it('propagates a thrown error immediately, without retrying', async () => {
    let calls = 0
    const slept: number[] = []

    await expect(
      fetchArchiveWithRetry({
        fetchArchive: async () => {
          calls += 1
          throw new Error('the control plane could not be reached')
        },
        retry: { attempts: 5, intervalMs: 1_000, sleep: instantSleep(slept) },
      }),
    ).rejects.toThrow('the control plane could not be reached')

    expect(calls).toBe(1)
    expect(slept).toEqual([])
  })
})
