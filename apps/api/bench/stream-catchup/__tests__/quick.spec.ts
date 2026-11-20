import { describe, expect, test } from 'bun:test'

import { type BenchOptions } from '../cli'
import { runMatrix } from '../main'

const quickOptions: BenchOptions = {
  sizes: [500],
  profiles: ['fast'],
  starts: ['none'],
  timeoutMs: 30_000,
  queryDelayMs: 0,
  seed: 1,
  json: false,
  quick: true,
}

describe('stream catch-up bench', () => {
  test('quick path reaches live', async () => {
    const rows = await runMatrix({ options: quickOptions })
    const row = rows[0]
    expect(row).toBeDefined()
    expect(row?.timedOut).toBe(false)
    expect(row?.liveMs).not.toBeNull()
    expect(row?.eventsFrames).toBeGreaterThan(0)
    expect(row?.bytesDown).toBeGreaterThan(0)
    expect(row?.readEvents).toBeGreaterThan(0)
  }, 60_000)
})
