import { ESandboxProvider } from '@dltech/atlas-protocol'
import { describe, expect, it } from 'bun:test'

import type { VercelSdk } from '../vercel-sdk'
import { VercelSandboxProvider } from '../vercel-sandbox-provider'

const CREDENTIALS = {
  provider: ESandboxProvider.Vercel,
  token: 'vercel-tok',
  teamId: 'team-1',
  projectId: 'proj-1',
} as const

const TARGET = { sandboxSessionId: 'pod-1', credentials: CREDENTIALS }

const providerOf = (args: {
  status: string
  billed?: number | undefined
  cgroupUsec: () => number
  exec?: (() => Promise<never>) | undefined
}): VercelSandboxProvider => {
  const sdk: VercelSdk = {
    getOrCreate: async () => {
      throw new Error('a CPU reading never creates a sandbox')
    },
    get: async () =>
      ({
        name: 'atlas-v2-pod-1',
        status: args.status,
        totalActiveCpuDurationMs: args.billed,
        runCommand:
          args.exec ??
          (async () => ({
            exitCode: 0,
            stdout: async () => JSON.stringify({ usageUsec: args.cgroupUsec() }),
          })),
      }) as never,
    list: async () => ({ toArray: async () => [] }),
  }
  return new VercelSandboxProvider({
    image: 'atlas-sandbox:latest',
    daemonBundle: { path: '/unused/daemon.js' },
    daemonSecret: 'top-secret',
    cloudUrl: 'https://api.test',
    sdk,
  })
}

describe('VercelSandboxProvider.activeCpuMs', () => {
  it('reads a running sandbox from the daemon, because the SDK reports 0 until it stops', async () => {
    const provider = providerOf({ status: 'running', billed: 0, cgroupUsec: () => 1_000_000 })

    expect(await provider.activeCpuMs({ target: TARGET })).toBe(1_030)
  })

  it('takes the closed run and its baseline from the same cgroup reading', async () => {
    let usec = 100_000
    const provider = providerOf({ status: 'running', billed: 0, cgroupUsec: () => usec })

    const baseline = await provider.activeCpuMs({ target: TARGET })
    usec = 1_100_000
    const atClose = await provider.activeCpuMs({ target: TARGET })

    expect(baseline).toBe(103)
    expect(atClose).toBe(1_133)
    expect((atClose ?? 0) - (baseline ?? 0)).toBe(1_030)
  })

  it('reads the SDK billed total of a stopped sandbox without exec', async () => {
    const provider = providerOf({
      status: 'stopped',
      billed: 61_950,
      cgroupUsec: () => 0,
      exec: async () => {
        throw new Error('a stopped sandbox is never woken for a reading')
      },
    })

    expect(await provider.activeCpuMs({ target: TARGET })).toBe(61_950)
  })

  it('reads no CPU while a stop has not reported its figure yet', async () => {
    const provider = providerOf({ status: 'stopping', billed: 0, cgroupUsec: () => 0 })

    expect(await provider.activeCpuMs({ target: TARGET })).toBeUndefined()
  })

  it('reads no CPU when the daemon cannot answer', async () => {
    const provider = providerOf({
      status: 'running',
      billed: 0,
      cgroupUsec: () => 0,
      exec: async () => {
        throw new Error('daemon unreachable')
      },
    })

    expect(await provider.activeCpuMs({ target: TARGET })).toBeUndefined()
  })
})
