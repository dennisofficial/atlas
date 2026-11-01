import { afterEach, describe, expect, it } from 'bun:test'

import type { WireTurn } from '@dltech/atlas-wire/web'

import { fakeFetch, queryUrl, trpcFailure, trpcOk } from './trpc-fake'

import {
  readSpendFromApi,
  spendOf,
  watchApiSpend,
  watchSpend,
  type SpendChannel,
} from '../thread-spend-source'

const realFetch = globalThis.fetch

const turn = (over: Partial<WireTurn> = {}): WireTurn => ({
  runId: 'r',
  threadId: 't',
  status: 'done',
  providerId: 'nobody',
  modelId: 'unpriced',
  steps: 1,
  inputTokens: 100,
  outputTokens: 10,
  cacheReadTokens: 40,
  cacheWriteTokens: 0,
  startedAt: '',
  endedAt: '',
  durationMs: 1,
  ...over,
})

describe('spendOf', () => {
  it('sums turns and leaves cost null when nothing is priced', () => {
    const spend = spendOf([turn(), turn()])
    expect(spend.inputTokens).toBe(200)
    expect(spend.uncachedInputTokens).toBe(120)
    expect(spend.costUsd).toBeNull()
  })
})

describe('watchSpend', () => {
  it('sums own and delegated turns, refreshes on ready, and stops', async () => {
    let ready: () => void = () => undefined
    let offs = 0
    const channel = {
      request: async () => ({ own: [turn()], delegated: [turn()] }),
      onReady: (listener: () => void) => {
        ready = listener
        return () => void offs++
      },
      onReload: () => () => void offs++,
    } as unknown as SpendChannel
    const seen: number[] = []
    const watch = watchSpend({
      channel,
      threadId: 't',
      onSpend: (s) => seen.push(s.outputTokens),
    })
    await Bun.sleep(0)
    ready()
    await Bun.sleep(0)
    watch.stop()
    expect(seen).toEqual([20, 20])
    expect(offs).toBe(2)
  })
})

describe('readSpendFromApi', () => {
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('reads threadTurns.list for the thread and tallies the turns', async () => {
    const calls = fakeFetch(() => trpcOk([turn(), turn({ outputTokens: 5 })]))
    const spend = await readSpendFromApi({ threadId: 'thr/1' })
    expect(calls.map((call) => call.url)).toEqual([
      queryUrl({ procedure: 'threadTurns.list', input: { threadId: 'thr/1' } }),
    ])
    expect(spend.outputTokens).toBe(15)
    expect(spend.costUsd).toBeNull()
  })
})

describe('watchApiSpend', () => {
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('reports the first read, refreshes on demand, and drops results after stop', async () => {
    const calls = fakeFetch(() => trpcOk([turn()]))
    const seen: number[] = []
    const watch = watchApiSpend({ threadId: 't', onSpend: (s) => seen.push(s.outputTokens) })
    await Bun.sleep(10)
    watch.refresh()
    await Bun.sleep(10)
    watch.refresh()
    watch.stop()
    await Bun.sleep(10)
    expect(calls).toHaveLength(3)
    expect(seen).toEqual([10, 10])
  })

  it('swallows a failed read', async () => {
    fakeFetch(() => trpcFailure({ status: 500 }))
    const seen: number[] = []
    watchApiSpend({ threadId: 't', onSpend: (s) => seen.push(s.outputTokens) })
    await Bun.sleep(10)
    expect(seen).toEqual([])
  })
})
