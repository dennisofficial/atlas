import { ESandboxCostProvider } from '@dltech/atlas-core'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { ESandboxStatus } from '@dltech/atlas-protocol'
import { describe, expect, it } from 'bun:test'

import { Agent37WebhookService } from './agent37-webhook.service'

const SESSION = 'ses_webhook'
const USER = 'usr_webhook'
const INSTANCE = 'ins_webhook'
const AT_START = '2026-11-23T19:45:00.000Z'
const AT_SLEEP = '2026-11-23T19:50:44.000Z'
const AT_WAKE = '2026-11-23T19:51:46.000Z'
const AT_LATER = '2026-11-23T19:51:52.000Z'
const AT_EARLIER = '2026-11-23T19:50:40.000Z'

const service = () =>
  new Agent37WebhookService(new ControlPlane({ store: new PostgresControlStore(db) }))

const statusAt = (status: ESandboxStatus, at: string): Promise<boolean> =>
  service().applyStatus({ instanceId: INSTANCE, status, at })

const seedSession = async (): Promise<void> => {
  await db.orm.public.Session.create({
    id: SESSION,
    userId: USER,
    mainThreadId: `thr_${SESSION}`,
    nextInboxId: 1,
    createdAt: new Date(AT_START),
    modelRef: 'anthropic/claude-haiku-4-5',
    modelEffort: 'medium',
    modelFast: false,
    sandboxProvider: 'agent37',
    credentialSource: 'platform',
    sandboxInstanceId: INSTANCE,
  })
}

const seedOpenRun = async (): Promise<void> => {
  await db.orm.public.SandboxRun.create({
    id: 'run-open',
    sessionId: SESSION,
    userId: USER,
    provider: ESandboxCostProvider.Agent37,
    sandboxInstanceId: INSTANCE,
    vcpus: 4,
    memoryGb: 8,
    diskGb: 32,
    startedAt: new Date(AT_START),
    endedAt: null,
  })
}

const rowsOf = () => db.orm.public.SandboxRun.where({ sessionId: SESSION }).all()
const openRowsOf = async () => (await rowsOf()).filter((row) => row.endedAt === null)

describe('Agent37WebhookService sandbox runs', () => {
  useTestDatabase()

  it('closes the open run at the time the pod reported sleeping', async () => {
    await seedSession()
    await seedOpenRun()

    expect(await statusAt(ESandboxStatus.Sleeping, AT_SLEEP)).toBe(true)

    const rows = await rowsOf()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.endedAt?.getTime()).toBe(Date.parse(AT_SLEEP))
  })

  it('opens a run shaped like the last one when the pod reports running again', async () => {
    await seedSession()
    await seedOpenRun()
    await statusAt(ESandboxStatus.Sleeping, AT_SLEEP)

    expect(await statusAt(ESandboxStatus.Running, AT_WAKE)).toBe(true)

    const open = await openRowsOf()
    expect(open).toHaveLength(1)
    expect(open[0]?.startedAt.getTime()).toBe(Date.parse(AT_WAKE))
    expect(open[0]?.provider).toBe(ESandboxCostProvider.Agent37)
    expect(open[0]?.vcpus).toBe(4)
    expect(open[0]?.memoryGb).toBe(8)
    expect(open[0]?.diskGb).toBe(32)
    expect(open[0]?.sandboxInstanceId).toBe(INSTANCE)
  })

  it('opens nothing when running repeats', async () => {
    await seedSession()
    await seedOpenRun()
    await statusAt(ESandboxStatus.Sleeping, AT_SLEEP)
    await statusAt(ESandboxStatus.Running, AT_WAKE)

    expect(await statusAt(ESandboxStatus.Running, AT_LATER)).toBe(true)

    const open = await openRowsOf()
    expect(open).toHaveLength(1)
    expect(open[0]?.startedAt.getTime()).toBe(Date.parse(AT_WAKE))
  })

  it('opens nothing for a running event older than the applied sleeping', async () => {
    await seedSession()
    await seedOpenRun()
    await statusAt(ESandboxStatus.Sleeping, AT_SLEEP)

    expect(await statusAt(ESandboxStatus.Running, AT_EARLIER)).toBe(false)

    expect(await openRowsOf()).toHaveLength(0)
  })

  it('opens nothing when the instance has no earlier run', async () => {
    await seedSession()
    await statusAt(ESandboxStatus.Sleeping, AT_SLEEP)

    expect(await statusAt(ESandboxStatus.Running, AT_WAKE)).toBe(true)

    expect(await rowsOf()).toHaveLength(0)
  })
})
