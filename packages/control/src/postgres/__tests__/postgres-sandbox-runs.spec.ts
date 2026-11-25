import { randomUUID } from 'node:crypto'

import { ESandboxCostProvider, ESandboxCostSource } from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import { PostgresSandboxRunStore } from '../postgres-sandbox-runs'

const SESSION = 'ses_runs'
const USER = 'usr_runs'
const AT = Date.parse('2026-11-23T19:50:00.000Z')

const seedSession = async (): Promise<void> => {
  await db.orm.public.Session.create({
    id: SESSION,
    userId: USER,
    mainThreadId: `thr_${SESSION}`,
    nextInboxId: 1,
    createdAt: new Date(AT),
    modelRef: 'anthropic/claude-haiku-4-5',
    modelEffort: 'medium',
    modelFast: false,
    sandboxProvider: 'agent37',
    credentialSource: 'platform',
    sandboxInstanceId: 'ins_runs',
  })
}

const runParams = {
  sessionId: SESSION,
  provider: ESandboxCostProvider.Agent37,
  sandboxInstanceId: 'ins_runs',
  vcpus: 4,
  memoryGb: 8,
  diskGb: 32,
  at: AT,
}

const rowsOf = () => db.orm.public.SandboxRun.where({ sessionId: SESSION }).all()

describe('PostgresSandboxRunStore', () => {
  useTestDatabase()

  it('two concurrent opens make one row', async () => {
    await seedSession()
    const store = new PostgresSandboxRunStore(db)

    await Promise.all([
      store.insertRun({ ...runParams, id: randomUUID() }),
      store.insertRun({ ...runParams, id: randomUUID() }),
    ])

    const rows = await rowsOf()
    expect(rows).toHaveLength(1)
  })

  it('opens a run once the previous one closed', async () => {
    await seedSession()
    const store = new PostgresSandboxRunStore(db)

    await store.insertRun({ ...runParams, id: 'run-1' })
    const [open] = await rowsOf()
    if (open === undefined) throw new Error('expected an open run')
    await store.closeRun({
      id: open.id,
      endedAt: AT + 60_000,
      costUsd: 0,
      costSource: ESandboxCostSource.Estimate,
      activeCpuMs: null,
      awakeMs: 60_000,
    })
    await store.insertRun({ ...runParams, id: 'run-2', at: AT + 60_000 })

    const rows = await rowsOf()
    expect(rows).toHaveLength(2)
    expect(rows.filter((row) => row.endedAt === null)).toHaveLength(1)
  })
})
