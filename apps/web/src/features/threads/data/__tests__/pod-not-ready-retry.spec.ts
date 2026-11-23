import { describe, expect, it } from 'bun:test'
import { EPodNotReady } from '@dltech/atlas-protocol'

import { CloudApiError } from '@/lib/cloud-api'
import {
  POD_RETRY_CAP_MS,
  POD_RETRY_FIRST_MS,
  POD_RETRY_TOTAL_MS,
  isPodNotReady,
  podRetryDelayMs,
  retryPodNotReady,
  withinPodRetryBudget,
} from '../pod-not-ready-retry'

const notReady = (): CloudApiError =>
  new CloudApiError({ message: 'pod is asleep', status: 412, code: EPodNotReady.NotReady })

const clockOf = () => {
  let at = 0
  const waits: number[] = []
  return {
    now: () => at,
    sleep: async (ms: number) => {
      waits.push(ms)
      at += ms
    },
    waits,
  }
}

describe('isPodNotReady', () => {
  it('recognises the marker and the older message', () => {
    expect(isPodNotReady(notReady())).toBe(true)
    expect(isPodNotReady(new CloudApiError({ message: 'pod is asleep', status: 412 }))).toBe(true)
    expect(isPodNotReady(new CloudApiError({ message: 'no', status: 400 }))).toBe(false)
    expect(isPodNotReady(new Error('pod is asleep'))).toBe(false)
  })
})

describe('pod retry budget', () => {
  it('doubles the wait and caps it', () => {
    expect(podRetryDelayMs({ attempt: 0 })).toBe(POD_RETRY_FIRST_MS)
    expect(podRetryDelayMs({ attempt: 1 })).toBe(POD_RETRY_FIRST_MS * 2)
    expect(podRetryDelayMs({ attempt: 9 })).toBe(POD_RETRY_CAP_MS)
  })

  it('refuses a wait that would pass the budget', () => {
    expect(
      withinPodRetryBudget({ elapsedMs: POD_RETRY_TOTAL_MS - 1, totalMs: POD_RETRY_TOTAL_MS }),
    ).toBe(true)
    expect(
      withinPodRetryBudget({ elapsedMs: POD_RETRY_TOTAL_MS, totalMs: POD_RETRY_TOTAL_MS }),
    ).toBe(false)
  })
})

describe('retryPodNotReady', () => {
  it('retries a not-ready answer and reports each wait', async () => {
    const clock = clockOf()
    const notices: number[] = []
    let attempts = 0
    const work = async () => {
      attempts += 1
      if (attempts < 3) throw notReady()
      return 'tree'
    }

    const result = await retryPodNotReady({
      work,
      now: clock.now,
      sleep: clock.sleep,
      onWaiting: (notice) => notices.push(notice.delayMs),
    })

    expect(result).toBe('tree')
    expect(attempts).toBe(3)
    expect(notices).toEqual([POD_RETRY_FIRST_MS, POD_RETRY_FIRST_MS * 2])
  })

  it('fails at once on any other error', async () => {
    const clock = clockOf()
    const failure = new CloudApiError({ message: 'no such session', status: 404 })

    await expect(
      retryPodNotReady({
        work: async () => {
          throw failure
        },
        now: clock.now,
        sleep: clock.sleep,
      }),
    ).rejects.toBe(failure)
    expect(clock.waits).toEqual([])
  })

  it('gives up when the budget runs out and rethrows the last answer', async () => {
    const clock = clockOf()
    let attempts = 0

    await expect(
      retryPodNotReady({
        work: async () => {
          attempts += 1
          throw notReady()
        },
        now: clock.now,
        sleep: clock.sleep,
      }),
    ).rejects.toBeInstanceOf(CloudApiError)

    expect(attempts).toBeGreaterThan(1)
    expect(clock.waits.reduce((sum, wait) => sum + wait, 0)).toBeLessThan(POD_RETRY_TOTAL_MS)
  })

  it('stops when the caller cancels', async () => {
    const controller = new AbortController()
    let attempts = 0

    await expect(
      retryPodNotReady({
        signal: controller.signal,
        work: async () => {
          attempts += 1
          controller.abort()
          throw notReady()
        },
      }),
    ).rejects.toBeTruthy()

    expect(attempts).toBe(1)
  })
})
