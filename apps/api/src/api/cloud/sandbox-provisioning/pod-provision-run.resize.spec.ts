import type { VercelSdk } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { runPodProvision } from './pod-provision-run'
import { EPodProvisionOutcome } from './pod-provision.contract'
import { fakeBoot, runDepsWith, seedSandboxRow, seedThread } from './sandbox-provisioning.fixture'

const FAST = { pollMs: 1, graceMs: 20, forceMs: 20 }

function restartingSdk(args: { parksItself: boolean }) {
  const calls: string[] = []
  let status = 'running'
  const sandbox = {
    get status() {
      return status
    },
    update: async (params: { resources?: { vcpus?: number } }) => {
      calls.push(`update:${params.resources?.vcpus}`)
    },
    runCommand: async () => {
      calls.push('notify')
      if (args.parksItself) status = 'stopped'
    },
    stop: async () => {
      calls.push('stop')
      status = 'stopped'
    },
  }
  const sdk = {
    get: async () => sandbox,
    getOrCreate: async () => {
      throw new Error('a resize restart never creates a sandbox')
    },
  } as unknown as VercelSdk
  return { sdk, calls }
}

const owedRestart = async (vcpus: number) => {
  await seedThread()
  await seedSandboxRow()
  await db.orm.public.CloudSandbox.where({ sessionId: 'ses_thr-1' }).update({ pendingVcpus: vcpus })
  const row = await db.orm.public.CloudSandbox.first({ sessionId: 'ses_thr-1' })
  return { threadId: 'thr-1', wakeClaim: row?.wakeClaim?.toISOString() ?? '' }
}

describe('runPodProvision resize restart', () => {
  useTestDatabase()

  it('saves the size, waits for serve to park, then boots and clears the owed restart', async () => {
    const payload = await owedRestart(8)
    const { sdk, calls } = restartingSdk({ parksItself: true })
    const { boot, calls: boots } = fakeBoot()

    const result = await runPodProvision({
      payload,
      deps: { ...runDepsWith({ boot, sdk }), resizeTiming: FAST },
    })

    expect(result.outcome).toBe(EPodProvisionOutcome.Running)
    expect(calls).toEqual(['update:8', 'notify'])
    expect(boots).toHaveLength(1)
    const row = await db.orm.public.CloudSandbox.first({ sessionId: 'ses_thr-1' })
    expect(row?.pendingVcpus).toBeNull()
    expect(row?.state).toBe('running')
  })

  it('force-stops a sandbox that does not park itself before booting', async () => {
    const payload = await owedRestart(4)
    const { sdk, calls } = restartingSdk({ parksItself: false })
    const { boot, calls: boots } = fakeBoot()

    await runPodProvision({ payload, deps: { ...runDepsWith({ boot, sdk }), resizeTiming: FAST } })

    expect(calls).toEqual(['update:4', 'notify', 'stop'])
    expect(boots).toHaveLength(1)
  })

  it('fails the claim and clears the owed restart when the resize cannot be saved', async () => {
    const payload = await owedRestart(4)
    const sdk = {
      get: async () => {
        throw new Error('vercel is down')
      },
    } as unknown as VercelSdk
    const { boot, calls: boots } = fakeBoot()

    const result = await runPodProvision({
      payload,
      deps: { ...runDepsWith({ boot, sdk }), resizeTiming: FAST },
    })

    expect(result.outcome).toBe(EPodProvisionOutcome.Failed)
    expect(boots).toHaveLength(0)
    const row = await db.orm.public.CloudSandbox.first({ sessionId: 'ses_thr-1' })
    expect(row?.pendingVcpus).toBeNull()
    expect(row?.wakeFailedAt).not.toBeNull()
  })
})
