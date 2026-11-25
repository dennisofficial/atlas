import { describe, expect, it } from 'bun:test'

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SandboxUnavailableError } from '@dltech/atlas-host'
import { ESandboxProvider } from '@dltech/atlas-protocol'
import { daemonToken } from '@dltech/atlas-protocol/engine'
import type { VercelSdk } from '../vercel-sdk'

import { sandboxNameOf } from '../vercel-names'
import { EPodStart } from '../sandbox-provider'
import { VercelSandboxProvider, WAKE_DEADLINE_MS } from '../vercel-sandbox-provider'

const CREDENTIALS = {
  provider: ESandboxProvider.Vercel,
  token: 'vercel-tok',
  teamId: 'team-1',
  projectId: 'proj-1',
} as const

const bundle = (): { bundle: { path: string }; cleanup: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-daemon-bundle-'))
  const path = join(dir, 'daemon.js')
  writeFileSync(path, '// daemon bundle\n')
  return { bundle: { path }, cleanup: () => rmSync(dir, { recursive: true }) }
}

const fakeSdk = (args: { onCreate?: boolean } = {}) => {
  const creates: Record<string, unknown>[] = []
  const sandbox = {
    name: '',
    writeFiles: async () => undefined,
    runCommand: async (params: { args?: string[]; detached?: boolean }) => {
      const script = params.args?.[1] ?? ''
      if (params.detached === true) return { exitCode: 0 }
      if (script.includes('echo alive')) return { exitCode: 0, stdout: async () => '' }
      if (script.startsWith('cat')) return { exitCode: 0, stdout: async () => '' }
      if (script.startsWith('curl')) return { exitCode: 0 }
      return { exitCode: 0, stdout: async () => '' }
    },
    domain: (port: number) => `https://route-${port}.vercel.run`,
  }
  const sdk: VercelSdk = {
    getOrCreate: async (params) => {
      creates.push(params as Record<string, unknown>)
      if (args.onCreate !== false) {
        await (params as { onCreate?: () => Promise<void> }).onCreate?.()
      }
      const name = (params as { name: string }).name
      return { ...sandbox, name } as never
    },
    get: async () => {
      throw new Error('unused')
    },
    list: async () => ({ toArray: async () => [] }),
  }
  return { sdk, creates }
}

describe('VercelSandboxProvider.wake', () => {
  it('mounts with the sandbox name in env and never the secret or token', async () => {
    const { bundle: b, cleanup } = bundle()
    const { sdk, creates } = fakeSdk()
    try {
      const provider = new VercelSandboxProvider({
        image: 'atlas-sandbox:latest',
        daemonBundle: b,
        daemonSecret: 'top-secret',
        cloudUrl: 'https://api.test',
        sdk,
      })
      const endpoint = await provider.wake({
        target: { sandboxSessionId: 's1', credentials: CREDENTIALS },
        signal: AbortSignal.timeout(5000),
      })

      expect(sandboxNameOf('s1')).toBe('atlas-v2-s1')
      expect(endpoint.sandboxName).toBe('atlas-v2-s1')
      expect(endpoint.url).toBe('wss://route-47300.vercel.run')
      expect(endpoint.token).toBe(daemonToken({ secret: 'top-secret', sandboxName: 'atlas-v2-s1' }))
      expect(endpoint.start).toBe(EPodStart.Created)

      expect(creates.length).toBe(1)
      const env = (creates[0] as { env: Record<string, string> }).env
      expect(env.ATLAS_SANDBOX_NAME).toBe('atlas-v2-s1')
      const envText = JSON.stringify(env)
      expect(envText).not.toContain('top-secret')
      expect(envText).not.toContain(endpoint.token)
      expect(env.VERCEL_TOKEN).toBeUndefined()
    } finally {
      cleanup()
    }
  })

  it('reports a sandbox that already existed as running', async () => {
    const { bundle: b, cleanup } = bundle()
    const { sdk } = fakeSdk({ onCreate: false })
    try {
      const provider = new VercelSandboxProvider({
        image: 'atlas-sandbox:latest',
        daemonBundle: b,
        daemonSecret: 'top-secret',
        cloudUrl: 'https://api.test',
        sdk,
      })
      const endpoint = await provider.wake({
        target: { sandboxSessionId: 's1', credentials: CREDENTIALS },
        signal: AbortSignal.timeout(5000),
      })

      expect(endpoint.start).toBe(EPodStart.Running)
    } finally {
      cleanup()
    }
  })
})

describe('VercelSandboxProvider.wake size', () => {
  const providerWith = (sdk: VercelSdk, path: string) =>
    new VercelSandboxProvider({
      image: 'atlas-sandbox:latest',
      daemonBundle: { path },
      daemonSecret: 'top-secret',
      cloudUrl: 'https://api.test',
      sdk,
    })

  it('creates the sandbox at the configured vCPU size', async () => {
    const { bundle: b, cleanup } = bundle()
    const { sdk, creates } = fakeSdk()
    try {
      await providerWith(sdk, b.path).wake({
        target: { sandboxSessionId: 's4', credentials: CREDENTIALS },
        signal: AbortSignal.timeout(5000),
        vcpus: 8,
      })
      expect(creates[0]).toMatchObject({ resources: { vcpus: 8 } })
    } finally {
      cleanup()
    }
  })

  it('leaves the size to Vercel when none is configured', async () => {
    const { bundle: b, cleanup } = bundle()
    const { sdk, creates } = fakeSdk()
    try {
      await providerWith(sdk, b.path).wake({
        target: { sandboxSessionId: 's5', credentials: CREDENTIALS },
        signal: AbortSignal.timeout(5000),
      })
      expect(creates[0]).not.toHaveProperty('resources')
    } finally {
      cleanup()
    }
  })
})

describe('VercelSandboxProvider.wake deadline', () => {
  const hangingSdk = (seen: AbortSignal[]): VercelSdk => ({
    getOrCreate: (params) => {
      if (params?.signal !== undefined) seen.push(params.signal)
      return new Promise(() => {})
    },
    get: async () => {
      throw new Error('unused')
    },
    list: async () => ({ toArray: async () => [] }),
  })

  const providerOf = (args: { sdk: VercelSdk; path: string; wakeDeadlineMs?: number }) =>
    new VercelSandboxProvider({
      image: 'atlas-sandbox:latest',
      daemonBundle: { path: args.path },
      daemonSecret: 'top-secret',
      cloudUrl: 'https://api.test',
      sdk: args.sdk,
      ...(args.wakeDeadlineMs === undefined ? {} : { wakeDeadlineMs: args.wakeDeadlineMs }),
    })

  it('throws SandboxUnavailableError when the mount hangs past the deadline', async () => {
    const { bundle: b, cleanup } = bundle()
    const seen: AbortSignal[] = []
    try {
      const provider = providerOf({ sdk: hangingSdk(seen), path: b.path, wakeDeadlineMs: 50 })
      const started = Date.now()
      const failure = await provider
        .wake({
          target: { sandboxSessionId: 's2', credentials: CREDENTIALS },
          signal: new AbortController().signal,
        })
        .catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(SandboxUnavailableError)
      expect((failure as Error).message).toContain('did not finish waking')
      expect(Date.now() - started).toBeLessThan(2000)
      expect(seen[0]?.aborted).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('throws SandboxUnavailableError when the caller aborts mid-wake', async () => {
    const { bundle: b, cleanup } = bundle()
    try {
      const provider = providerOf({ sdk: hangingSdk([]), path: b.path })
      const controller = new AbortController()
      const waking = provider.wake({
        target: { sandboxSessionId: 's3', credentials: CREDENTIALS },
        signal: controller.signal,
      })
      controller.abort()
      await expect(waking).rejects.toBeInstanceOf(SandboxUnavailableError)
    } finally {
      cleanup()
    }
  })

  it('says five minutes for the default deadline', () => {
    expect(WAKE_DEADLINE_MS).toBe(5 * 60_000)
  })
})

describe('VercelSandboxProvider.keepAlive', () => {
  it('renews the sandbox session deadline to the requested time', async () => {
    const extended: number[] = []
    const sandbox = {
      name: sandboxNameOf('s5'),
      expiresAt: new Date(1_000_000),
      currentSession: () => ({
        status: 'running',
        extendTimeout: async (ms: number) => {
          extended.push(ms)
        },
      }),
    }
    const sdk: VercelSdk = {
      getOrCreate: async () => sandbox as never,
      get: async () => sandbox as never,
      list: async () => ({ toArray: async () => [] }),
    }
    const provider = new VercelSandboxProvider({
      image: 'atlas-sandbox:latest',
      daemonBundle: { path: '/unused/daemon.js' },
      daemonSecret: 'top-secret',
      cloudUrl: 'https://api.test',
      sdk,
    })

    await provider.keepAlive({
      target: { sandboxSessionId: 's5', credentials: CREDENTIALS },
      until: 1_600_000,
    })

    expect(extended).toEqual([600_000])
  })
})

describe('VercelSandboxProvider credential guard', () => {
  const provider = new VercelSandboxProvider({
    image: 'atlas-sandbox:latest',
    daemonBundle: { path: '/unused/daemon.js' },
    daemonSecret: 'top-secret',
    cloudUrl: 'https://api.test',
  })
  const target = {
    sandboxSessionId: 's6',
    credentials: { provider: ESandboxProvider.Agent37, apiKey: 'a37-key' },
  } as const

  it('refuses a target that is not a Vercel sandbox', async () => {
    await expect(provider.wake({ target, signal: AbortSignal.timeout(1_000) })).rejects.toThrow(
      'agent37',
    )
    await expect(provider.stop({ target })).rejects.toThrow('agent37')
    await expect(provider.keepAlive({ target, until: 1 })).rejects.toThrow('agent37')
  })
})
