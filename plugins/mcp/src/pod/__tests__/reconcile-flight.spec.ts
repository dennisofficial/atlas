import { describe, expect, it } from 'bun:test'

import type { McpCloudRow } from '../../core'
import { McpStore } from '../store'
import { fakeDaemon, fakeProxyControl, rig } from './support'

const paperTransport = { kind: 'stdio' as const, command: 'paper' }

const row = (): McpCloudRow => ({
  source: 'user',
  spec: { name: 'paper', transport: paperTransport, proxy: true },
})

const pause = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

const until = async (ready: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (ready()) return
    await pause(2)
  }
  throw new Error('the MCP connections never settled')
}

const storeFor = () => {
  const daemon = fakeDaemon({})
  const proxy = fakeProxyControl({ behaviours: { paper: { silent: true } } })
  let reads = 0
  const store = new McpStore({
    ctx: rig(daemon, { mcp: proxy.control }),
    config: {
      read: async () => {
        reads += 1
        return { rows: [row()], rejections: [] }
      },
    },
    connectTimeoutMs: 400,
    reconcileBudgetMs: 10,
  })
  return { store, proxy, reads: (): number => reads }
}

describe('a refresh that outlives its budget', () => {
  it('holds the single flight until the connect settles and coalesces one follow-up', async () => {
    const { store, proxy, reads } = storeFor()
    await store.boot()
    expect(proxy.opens).toHaveLength(1)

    store.refresh()
    await until(() => proxy.opens.length === 2)
    await pause(40)

    store.refresh()
    store.refresh()
    await pause(40)

    expect(proxy.opens).toHaveLength(2)
    expect(reads()).toBe(2)

    await until(() => proxy.opens.length === 3)
    await pause(40)

    expect(proxy.opens).toHaveLength(3)
    expect(reads()).toBe(3)
  })
})
