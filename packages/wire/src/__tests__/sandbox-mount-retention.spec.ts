import { describe, expect, it } from 'bun:test'
import type { Sandbox } from '@vercel/sandbox'
import { mountWithRetries } from '../sandbox-mount'
import { SANDBOX_SNAPSHOT_RETENTION, type VercelSdk } from '../sandbox-sdk'

describe('mountWithRetries snapshot retention', () => {
  it('creates the sandbox keeping only the latest snapshot and deleting evicted ones', async () => {
    const seen: Parameters<VercelSdk['getOrCreate']>[0][] = []
    const sdk: VercelSdk = {
      getOrCreate: async (params) => {
        seen.push(params)
        return {} as Sandbox
      },
      get: async () => ({}) as Sandbox,
    }

    await mountWithRetries({
      sdk,
      cloudUrl: 'https://api.example.com',
      retry: { attempts: 1, delayMs: 0 },
      imageOptimize: { attempts: 1, delayMs: 0 },
      credentials: { token: 't', teamId: 'team', projectId: 'prj' },
      name: 'atlas-thread-x',
      image: 'atlas-sandbox:1',
      threadId: 'brn_cloud',
      token: 'serve-token',
      onCreate: async () => {},
    })

    expect(SANDBOX_SNAPSHOT_RETENTION).toEqual({ count: 1, deleteEvicted: true })
    expect(seen[0]).toMatchObject({
      persistent: true,
      keepLastSnapshots: { count: 1, deleteEvicted: true },
    })
  })
})
