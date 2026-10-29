import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { APIError } from '@vercel/sandbox'
import { describe, expect, it } from 'bun:test'
import { waitFor } from '../../../../test/fake-timers'
import { EPodProvisionOutcome } from './pod-provision.contract'
import { fakeSdk } from './pod-provision.sdk.fixture'
import { runPodProvision } from './pod-provision-run'
import {
  CREDENTIALS,
  fakeBoot,
  runDepsWith,
  sandboxRows,
  seedSandboxRow,
  seedThread,
} from './sandbox-provisioning.fixture'
import { podServiceOver, realEndpoints } from './thread-pod.fixture'
import type { VercelSandboxClient } from '../../platform/sandboxes/vercel-sandbox.client'

const scope = { userId: 'usr-1', threadId: 'thr-1' }

const provisionWhile = async (args: {
  during: () => Promise<void>
  sdk?: ReturnType<typeof fakeSdk>
}) => {
  await seedThread()
  await seedSandboxRow()
  const [row] = await sandboxRows()
  const payload = { threadId: 'thr-1', wakeClaim: row?.wakeClaim?.toISOString() ?? '' }
  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const { boot, calls } = fakeBoot({ held })
  const sdk = args.sdk ?? fakeSdk()
  const logs: string[] = []
  const run = runPodProvision({
    payload,
    deps: runDepsWith({ boot, sdk: sdk.sdk, log: (line) => logs.push(line) }),
  })
  await waitFor(() => expect(calls).toHaveLength(1))
  await args.during()
  release()
  return { output: await run, sdk, logs }
}

const destroyThroughService = (deleteFails?: Error) => async () => {
  const vercel = {
    delete: async () => {
      if (deleteFails !== undefined) throw deleteFails
    },
  } as unknown as VercelSandboxClient
  await podServiceOver(realEndpoints(), vercel)
    .destroy(scope)
    .catch(() => undefined)
}

describe('runPodProvision after the pod was destroyed', () => {
  useTestDatabase()

  it('deletes the sandbox its boot just created when the row is gone', async () => {
    const { output, sdk } = await provisionWhile({ during: destroyThroughService() })

    expect(output).toEqual({ outcome: EPodProvisionOutcome.Superseded })
    expect(await sandboxRows()).toHaveLength(0)
    expect(sdk.deleted).toEqual(['atlas-thread-1'])
    expect(sdk.gets[0]).toMatchObject({ ...CREDENTIALS, name: 'atlas-thread-1', resume: false })
  })

  it('deletes it too when a failed destroy left the row with a cleared claim', async () => {
    const { output, sdk } = await provisionWhile({
      during: destroyThroughService(new Error('vercel is down')),
    })

    expect(output).toEqual({ outcome: EPodProvisionOutcome.Superseded })
    expect((await sandboxRows())[0]?.wakeClaim).toBeNull()
    expect(sdk.deleted).toEqual(['atlas-thread-1'])
  })

  it('keeps the sandbox when a newer wake took the claim under the same name', async () => {
    const { output, sdk } = await provisionWhile({
      during: async () => {
        await db.orm.public.CloudSandbox.where({ sessionId: 'ses_thr-1' }).update({
          wakeClaim: new Date(Date.now() + 60_000),
        })
      },
    })

    expect(output).toEqual({ outcome: EPodProvisionOutcome.Superseded })
    expect(sdk.gets).toHaveLength(0)
    expect(sdk.deleted).toHaveLength(0)
  })

  it('keeps the sandbox when the claim was cleared by a failure recorded after it', async () => {
    const { sdk } = await provisionWhile({
      during: async () => {
        await db.orm.public.CloudSandbox.where({ sessionId: 'ses_thr-1' }).update({
          wakeClaim: null,
          wakeFailedAt: new Date(Date.now() + 1_000),
        })
      },
    })

    expect(sdk.deleted).toHaveLength(0)
  })

  it('treats a sandbox Vercel no longer has as already gone', async () => {
    const sdk = fakeSdk({ getFailure: new APIError(new Response('', { status: 404 })) })

    const { output } = await provisionWhile({ during: destroyThroughService(), sdk })

    expect(output).toEqual({ outcome: EPodProvisionOutcome.Superseded })
    expect(sdk.deleted).toHaveLength(0)
  })

  it('logs a failed rollback and still answers superseded', async () => {
    const sdk = fakeSdk({ deleteFailure: new Error('vercel is down') })

    const { output, logs } = await provisionWhile({ during: destroyThroughService(), sdk })

    expect(output).toEqual({ outcome: EPodProvisionOutcome.Superseded })
    expect(logs.some((line) => line.includes('vercel is down'))).toBe(true)
  })

  it('never touches the sandbox of a provision that marked its row running', async () => {
    const sdk = fakeSdk()

    await provisionWhile({ during: () => Promise.resolve(), sdk })

    expect(sdk.gets).toHaveLength(0)
    expect((await sandboxRows())[0]?.state).toBe('running')
  })
})
