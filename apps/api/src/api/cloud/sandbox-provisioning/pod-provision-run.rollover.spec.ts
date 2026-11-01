import type { VercelSdk } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { runPodProvision } from './pod-provision-run'
import { EPodProvisionOutcome } from './pod-provision.contract'
import { fakeBoot, runDepsWith, seedSandboxRow, seedThread } from './sandbox-provisioning.fixture'

const FAST = { pollMs: 1, graceMs: 20, forceMs: 20 }

describe('runPodProvision rollover', () => {
  useTestDatabase()

  it('stops the named session before booting', async () => {
    await seedThread()
    await seedSandboxRow()
    const row = await db.orm.public.CloudSandbox.first({ sessionId: 'ses_thr-1' })
    const order: string[] = []
    let status = 'running'
    const sdk = {
      get: async () => ({
        get status() {
          return status
        },
        currentSession: () => ({ sessionId: 'ses-old' }),
        stop: async () => {
          order.push('stop')
          status = 'stopped'
        },
      }),
    } as unknown as VercelSdk
    const { boot } = fakeBoot()
    const booting = {
      boot: async (args: Parameters<typeof boot.boot>[0]) => {
        order.push('boot')
        return boot.boot(args)
      },
    }

    const result = await runPodProvision({
      payload: {
        threadId: 'thr-1',
        wakeClaim: row?.wakeClaim?.toISOString() ?? '',
        stopSessionId: 'ses-old',
      },
      deps: { ...runDepsWith({ boot: booting, sdk }), resizeTiming: FAST },
    })

    expect(result.outcome).toBe(EPodProvisionOutcome.Running)
    expect(order).toEqual(['stop', 'boot'])
  })
})
