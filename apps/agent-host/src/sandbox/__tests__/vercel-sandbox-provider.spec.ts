import { describe, expect, it } from 'bun:test'

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SandboxUnavailableError } from '@dltech/atlas-host'
import { daemonToken } from '@dltech/atlas-protocol/engine'
import type { VercelSdk } from '../vercel-sdk'

import { sandboxNameOf } from '../sandbox-provider'
import { VercelSandboxProvider, WAKE_DEADLINE_MS } from '../vercel-sandbox-provider'

const CREDENTIALS = { token: 'vercel-tok', teamId: 'team-1', projectId: 'proj-1' }

const bundle = (): { bundle: { path: string }; cleanup: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-daemon-bundle-'))
  const path = join(dir, 'daemon.js')
  writeFileSync(path, '// daemon bundle\n')
  return { bundle: { path }, cleanup: () => rmSync(dir, { recursive: true }) }
}

const fakeSdk = () => {
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
      const name = (params as { name: string }).name
      return { ...sandbox, name } as never
    },
    get: async () => {
      throw new Error('unused')
    },
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
        sessionId: 's1',
        credentials: CREDENTIALS,
        signal: AbortSignal.timeout(5000),
      })

      expect(sandboxNameOf('s1')).toBe('atlas-v2-s1')
      expect(endpoint.sandboxName).toBe('atlas-v2-s1')
      expect(endpoint.url).toBe('wss://route-3000.vercel.run')
      expect(endpoint.token).toBe(daemonToken({ secret: 'top-secret', sandboxName: 'atlas-v2-s1' }))

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
        .wake({ sessionId: 's2', credentials: CREDENTIALS, signal: new AbortController().signal })
        .catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(SandboxUnavailableError)
      expect((failure as Error).message).toContain('did not wake')
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
        sessionId: 's3',
        credentials: CREDENTIALS,
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
