import type { Sandbox } from '@vercel/sandbox'
import type { ServeInstaller, ServeLauncher, VercelSdk } from '@dltech/atlas-wire'
import { describe, expect, it, vi } from 'bun:test'

import {
  ResumeTokenMissingError,
  VercelSandboxWakeBoot,
  type WakeBootArgs,
} from './github-sandbox-wake-boot'
import { releaseOnlyServeInstaller } from './github-sandbox-wake-installer'

const fakeSandbox = (deleted: string[]): Sandbox =>
  ({
    name: 'atlas-sandbox-abc',
    status: 'running',
    currentSession: () => ({ sessionId: 'ses-live' }),
    domain: (port: number) => `https://atlas-${port}.vercel.run`,
    delete: async () => {
      deleted.push('atlas-sandbox-abc')
    },
  }) as unknown as Sandbox

function harness(options: { created: boolean; launchFails?: boolean }) {
  const deleted: string[] = []
  const sandbox = fakeSandbox(deleted)
  const getOrCreateParams: Array<Record<string, unknown>> = []
  const sdk: VercelSdk = {
    getOrCreate: async (params) => {
      getOrCreateParams.push(params as unknown as Record<string, unknown>)
      if (options.created) await params?.onCreate?.(sandbox)
      return sandbox
    },
    get: async () => sandbox,
  }
  const launch = vi.fn<ServeLauncher>(async () => {
    if (options.launchFails) throw new Error('serve did not answer /v1/health')
  })
  const onFreshSandbox = vi.fn(async () => undefined)
  const boot = new VercelSandboxWakeBoot({ sdk, log: () => {}, launch })
  const args: WakeBootArgs = {
    credentials: { token: 'vercel-token', teamId: 'team-1', projectId: 'proj-1' },
    name: 'atlas-sandbox-abc',
    threadId: 'thr-1',
    image: 'atlas-sandbox:latest',
    cloudUrl: 'https://api.byatlas.io',
    serveVersion: '1.92.6',
    freshToken: 'fresh-token',
    resumeToken: 'stored-token',
    onFreshSandbox,
  }
  return { boot, args, launch, deleted, getOrCreateParams, onFreshSandbox }
}

describe('VercelSandboxWakeBoot', () => {
  it('resumes from the snapshot, launches the pinned serve under the stored token, and never deletes', async () => {
    const { boot, args, launch, deleted, getOrCreateParams, onFreshSandbox } = harness({ created: false })

    const result = await boot.boot(args)

    expect(result).toEqual({ serveUrl: 'https://atlas-3000.vercel.run', created: false })
    expect(getOrCreateParams[0]).toMatchObject({ name: 'atlas-sandbox-abc', persistent: true, resume: true })
    expect(getOrCreateParams[0]).not.toHaveProperty('mounts')
    expect(launch).toHaveBeenCalledTimes(1)
    expect(launch.mock.calls[0]?.[0]).toMatchObject({
      token: 'stored-token',
      desiredVersion: '1.92.6',
    })
    expect(launch.mock.calls[0]?.[0]).not.toHaveProperty('sandboxSessionId')
    expect(onFreshSandbox).not.toHaveBeenCalled()
    expect(deleted).toEqual([])
  })

  it('a fresh create adopts the minted token before serve launches under it', async () => {
    const { boot, args, launch, onFreshSandbox } = harness({ created: true })

    const result = await boot.boot(args)

    expect(result.created).toBe(true)
    expect(onFreshSandbox).toHaveBeenCalledTimes(1)
    expect(launch.mock.calls[0]?.[0]).toMatchObject({ token: 'fresh-token' })
  })

  it('never retries a failed pinned launch with latest', async () => {
    const { boot, args, launch } = harness({ created: false, launchFails: true })

    await expect(boot.boot(args)).rejects.toThrow('serve did not answer')

    expect(launch).toHaveBeenCalledTimes(1)
  })

  it('a failed resume leaves the sandbox in place', async () => {
    const { boot, args, deleted } = harness({ created: false, launchFails: true })

    await expect(boot.boot(args)).rejects.toThrow()

    expect(deleted).toEqual([])
  })

  it('rolls back a sandbox it created fresh when the boot fails', async () => {
    const { boot, args, deleted } = harness({ created: true, launchFails: true })

    await expect(boot.boot(args)).rejects.toThrow('serve did not answer')

    expect(deleted).toEqual(['atlas-sandbox-abc'])
  })

  it('refuses to launch a resumed sandbox without its stored token rather than minting over it', async () => {
    const { boot, args, launch, deleted } = harness({ created: false })

    await expect(boot.boot({ ...args, resumeToken: undefined })).rejects.toBeInstanceOf(
      ResumeTokenMissingError,
    )

    expect(launch).not.toHaveBeenCalled()
    expect(deleted).toEqual([])
  })
})

describe('releaseOnlyServeInstaller', () => {
  const sandbox = fakeSandbox([])

  it('refuses a dev pin, since only the client that built it can upload it', async () => {
    const install = vi.fn<ServeInstaller>(async () => undefined)

    await expect(
      releaseOnlyServeInstaller({ install })({ sandbox, version: 'dev-0123456789ab' }),
    ).rejects.toThrow(
      'sandbox atlas-sandbox-abc needs dev serve dev-0123456789ab, which only the client that built it can upload — the wake fails rather than booting a release',
    )
    expect(install).not.toHaveBeenCalled()
  })

  it.each(['1.92.6', undefined])('delegates %s to the release download', async (version) => {
    const install = vi.fn<ServeInstaller>(async () => undefined)

    await releaseOnlyServeInstaller({ install })({ sandbox, version })

    expect(install).toHaveBeenCalledWith({ sandbox, version })
  })
})
