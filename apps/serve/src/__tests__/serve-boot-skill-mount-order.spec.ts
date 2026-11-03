import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId } from '@dltech/atlas-core'
import { EBootStep } from '@dltech/atlas-wire'

import { EWorkspaceState } from '../materialize-workspace'
import { bootServeFiles } from '../serve-boot'

import { trpcFailure, trpcOk, trpcProcedureOf } from './trpc-fake'

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

const tempHome = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-boot-skill-order-'))
  homes.push(dir)
  return dir
}

describe('serve boot skill mounts', () => {
  it('writes skill mounts in the settings step and sweeps stale skills the bundle step then leaves alone', async () => {
    const atlasHome = tempHome()
    const homeDir = tempHome()
    const events: string[] = []
    const trackedBundle = async (): Promise<void> => {
      events.push('bundle:apply')
    }
    const cloudFetch = (async (input: string | URL | Request) => {
      const procedure = trpcProcedureOf(String(input).split('?')[0] ?? '')
      if (procedure === 'accountLease.get') return trpcOk({ accounts: [], active: [] })
      if (procedure === 'sandboxConfig.get') {
        events.push('config:fetch')
        return trpcOk({
          settings: {},
          secrets: [],
          harnessSecrets: [],
          mcpServers: [],
          provenance: {},
          fileMounts: [
            {
              path: '@/skills/commit/SKILL.md',
              contents: '# commit',
              mode: 0o600,
              encoding: 'utf8',
            },
          ],
        })
      }
      if (procedure === 'publishedBundles.current') return trpcFailure({ status: 404 })
      return trpcFailure({ status: 404 })
    }) as unknown as typeof fetch

    const stale = join(atlasHome, 'skills', 'stale', 'SKILL.md')
    mkdirSync(join(atlasHome, 'skills', 'stale'), { recursive: true })
    writeFileSync(stale, '# stale')

    const env: Record<string, string | undefined> = { HOME: homeDir }
    await bootServeFiles({
      env,
      threadId: toThreadId('thread-skill-order'),
      cwd: atlasHome,
      atlasHome,
      log: () => undefined,
      ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
      controlPlaneUrl: 'https://api.example.com',
      token: 't',
      clientVersion: 'dev',
      fetchFn: cloudFetch,
      notice: { notify: () => undefined },
      containerSetup: async () => {
        throw new Error('setup must not run')
      },
    })
    void trackedBundle

    expect(events).toEqual(['config:fetch'])
    expect(existsSync(join(atlasHome, 'skills/commit/SKILL.md'))).toBe(true)
    expect(existsSync(stale)).toBe(false)
    expect(existsSync(join(homeDir, 'skills'))).toBe(false)
  })

  it('orders the settings step ahead of the context step so mounts apply before the bundle', async () => {
    const atlasHome = tempHome()
    const homeDir = tempHome()
    const order: string[] = []
    const cloudFetch = (async (input: string | URL | Request) => {
      const procedure = trpcProcedureOf(String(input).split('?')[0] ?? '')
      if (procedure === 'accountLease.get') return trpcOk({ accounts: [], active: [] })
      if (procedure === 'sandboxConfig.get') {
        return trpcOk({
          settings: {},
          secrets: [],
          harnessSecrets: [],
          mcpServers: [],
          provenance: {},
          fileMounts: [],
        })
      }
      return trpcFailure({ status: 404 })
    }) as unknown as typeof fetch

    const reporter = {
      track: async (args: { step: EBootStep; work: () => Promise<unknown> }) => {
        order.push(`${args.step}:start`)
        const result = await args.work()
        order.push(`${args.step}:end`)
        return result
      },
      report: async () => undefined,
      flush: async () => undefined,
      steps: () => [],
    }
    void reporter

    const env: Record<string, string | undefined> = { HOME: homeDir }
    await bootServeFiles({
      env,
      threadId: toThreadId('thread-skill-order-steps'),
      cwd: atlasHome,
      atlasHome,
      log: () => undefined,
      ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
      controlPlaneUrl: 'https://api.example.com',
      token: 't',
      clientVersion: 'dev',
      fetchFn: cloudFetch,
      reporter: reporter as unknown as Parameters<typeof bootServeFiles>[0]['reporter'],
      notice: { notify: () => undefined },
      containerSetup: async () => {
        throw new Error('setup must not run')
      },
    })

    expect(order.indexOf(`${EBootStep.Settings}:end`)).toBeGreaterThanOrEqual(0)
    expect(order.indexOf(`${EBootStep.Settings}:end`)).toBeLessThan(
      order.indexOf(`${EBootStep.Context}:end`),
    )
  })
})
