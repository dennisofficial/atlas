import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId } from '@dltech/atlas-core'
import {
  createBootReporter,
  EBootStep,
  EBootStepState,
  type BootStepEvent,
} from '@dltech/atlas-wire'

import { EContainerSetupResult } from '../container-setup'
import { EWorkspaceState } from '../materialize-workspace'
import { bootServeFiles } from '../serve-boot'

import { trpcFailure, trpcOk, trpcProcedureOf } from './trpc-fake'

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

const cloudFetch = (async (input: string | URL | Request) => {
  const procedure = trpcProcedureOf(String(input).split('?')[0] ?? '')
  if (procedure === 'accountLease.get') return trpcOk({ accounts: [], active: [] })
  if (procedure === 'sandboxConfig.get') {
    return trpcOk({
      settings: {},
      secrets: [{ name: 'PROJECT_SECRET', value: 'from-settings' }],
      harnessSecrets: [],
      mcpServers: [],
      fileMounts: [],
      provenance: {},
    })
  }
  return trpcFailure({ status: 404 })
}) as unknown as typeof fetch

describe('serve boot setup order', () => {
  it('applies settings before setup and finishes context while setup is still running', async () => {
    const atlasHome = mkdtempSync(join(tmpdir(), 'atlas-boot-setup-order-'))
    homes.push(atlasHome)
    const env: Record<string, string | undefined> = {}
    const events: BootStepEvent[] = []
    const reporter = createBootReporter({ sink: async (batch) => void events.push(...batch) })
    const order: string[] = []
    const stepsSeen = reporter.track.bind(reporter)
    const trackedReporter = Object.assign(Object.create(reporter), {
      track: async (args: Parameters<typeof reporter.track>[0]) => {
        order.push(`${args.step}:start`)
        const result = await stepsSeen(args)
        order.push(`${args.step}:end`)
        return result
      },
    }) as typeof reporter

    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let setupEnv: string | undefined
    const booting = bootServeFiles({
      env,
      threadId: toThreadId('thread-setup-order'),
      cwd: atlasHome,
      atlasHome,
      log: () => undefined,
      ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
      controlPlaneUrl: 'https://api.example.com',
      token: 't',
      clientVersion: 'dev',
      fetchFn: cloudFetch,
      reporter: trackedReporter,
      notice: { notify: () => undefined },
      containerSetup: async ({ env: setupEnvironment }) => {
        order.push('setup:running')
        setupEnv = setupEnvironment.PROJECT_SECRET
        await gate
        order.push('setup:released')
        return EContainerSetupResult.Ran
      },
    })

    await Bun.sleep(100)
    expect(order).toContain(`${EBootStep.Context}:end`)
    expect(order).not.toContain('setup:released')
    release()
    await booting
    await reporter.flush()

    expect(order.indexOf(`${EBootStep.Settings}:end`)).toBeLessThan(order.indexOf('setup:running'))
    expect(setupEnv).toBe('from-settings')
    expect(
      events.some((e) => e.step === EBootStep.Context && e.state === EBootStepState.Done),
    ).toBe(true)
  })
})
