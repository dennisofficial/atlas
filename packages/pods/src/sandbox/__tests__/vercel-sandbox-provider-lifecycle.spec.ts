import { describe, expect, it } from 'bun:test'

import { ESandboxProvider } from '@dltech/atlas-protocol'

import type { VercelSdk } from '../vercel-sdk'

import { sandboxNameOf } from '../vercel-names'
import { VercelSandboxProvider } from '../vercel-sandbox-provider'

const CREDENTIALS = {
  provider: ESandboxProvider.Vercel,
  token: 'vercel-tok',
  teamId: 'team-1',
  projectId: 'proj-1',
} as const

const providerWith = (sdk: VercelSdk) =>
  new VercelSandboxProvider({
    image: 'atlas-sandbox:latest',
    daemonBundle: { path: '/unused/daemon.js' },
    daemonSecret: 'top-secret',
    cloudUrl: 'https://api.test',
    sdk,
  })

const unusedSdk = (overrides: Partial<VercelSdk>): VercelSdk => ({
  getOrCreate: async () => {
    throw new Error('unused')
  },
  get: async () => {
    throw new Error('unused')
  },
  list: async () => ({ toArray: async () => [] }),
  ...overrides,
})

describe('VercelSandboxProvider.list', () => {
  it("keeps only this host's pod sandboxes and answers them by pod session", async () => {
    const calls: Record<string, unknown>[] = []
    const listed = [
      { name: 'atlas-v2-s1', status: 'running', createdAt: 1_700_000_000_000 },
      { name: 'someone-elses-sandbox', status: 'running', createdAt: 1_700_000_000_001 },
      { name: 'atlas-v2-s2', status: 'stopped', createdAt: 1_700_000_000_002 },
    ]
    const sdk = unusedSdk({
      list: async (params) => {
        calls.push(params as Record<string, unknown>)
        return { toArray: async () => listed }
      },
    })

    const listings = await providerWith(sdk).list({ credentials: CREDENTIALS })

    expect(listings).toEqual([
      { sandboxSessionId: 's1', running: true, createdAt: 1_700_000_000_000 },
      { sandboxSessionId: 's2', running: false, createdAt: 1_700_000_000_002 },
    ])
    expect(calls[0]).toMatchObject({ teamId: 'team-1', projectId: 'proj-1', limit: 50 })
  })

  it('refuses credentials that are not Vercel', async () => {
    await expect(
      providerWith(unusedSdk({})).list({
        credentials: { provider: ESandboxProvider.Agent37, apiKey: 'a37' },
      }),
    ).rejects.toThrow('agent37')
  })
})

describe('VercelSandboxProvider.delete', () => {
  it('is a success when the sandbox is already gone', async () => {
    const sdk = unusedSdk({
      get: async () => {
        throw new Error("Sandbox 'atlas-v2-s7' not found for this project")
      },
    })
    await expect(
      providerWith(sdk).delete({ target: { sandboxSessionId: 's7', credentials: CREDENTIALS } }),
    ).resolves.toBeUndefined()
  })

  it('leaves a running sandbox alone, because a live pod is not storage', async () => {
    const calls: string[] = []
    const sandbox = {
      name: sandboxNameOf('s8'),
      status: 'running',
      stop: async () => {
        calls.push('stop')
      },
      delete: async () => {
        calls.push('delete')
      },
    }
    const sdk = unusedSdk({
      get: async (params) => {
        expect(params).toMatchObject({ name: 'atlas-v2-s8', resume: false })
        return sandbox as never
      },
    })

    await providerWith(sdk).delete({
      target: { sandboxSessionId: 's8', credentials: CREDENTIALS },
    })

    expect(calls).toEqual([])
  })

  it('deletes a stopped sandbox without stopping it again', async () => {
    const calls: string[] = []
    const sandbox = {
      name: sandboxNameOf('s9'),
      status: 'stopped',
      stop: async () => {
        calls.push('stop')
      },
      delete: async () => {
        calls.push('delete')
      },
    }
    const sdk = unusedSdk({ get: async () => sandbox as never })

    await providerWith(sdk).delete({
      target: { sandboxSessionId: 's9', credentials: CREDENTIALS },
    })

    expect(calls).toEqual(['delete'])
  })
})
