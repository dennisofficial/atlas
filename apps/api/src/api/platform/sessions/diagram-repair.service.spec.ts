import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { EDiagramRepair, type DiagramRepairOutcome } from '@dltech/atlas-core'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { NotFoundException } from '@nestjs/common'
import { describe, expect, it } from 'bun:test'

import { DiagramRepairService } from './diagram-repair.service'
import type { DiagramRepairer } from '../../../agent'

const testDb = useTestDatabase()

const SOURCE = 'graph TD\n  A[one; two] --> B[done]'
const REPAIRED = 'graph TD\n  A["one; two"] --> B[done]'

const seed = async () => {
  const { db } = testDb()
  await db.orm.public.User.create({ id: 'user-1', name: 'u', email: 'u@test.local' })
  await db.orm.public.User.create({ id: 'user-2', name: 'v', email: 'v@test.local' })
  const plane = new ControlPlane({ store: new PostgresControlStore(db) })
  await plane.createSession({
    sessionId: 's-1',
    userId: 'user-1',
    projectId: null,
    mainThreadId: 't-1',
  })
  await plane.createSession({
    sessionId: 's-2',
    userId: 'user-2',
    projectId: null,
    mainThreadId: 't-2',
  })
  return { db, plane }
}

type RepairerAsk = Parameters<DiagramRepairer>[0]

const countingRepairer = (
  answer: (ask: RepairerAsk) => Promise<DiagramRepairOutcome>,
  modelRef = 'anthropic/claude-opus-4-1',
) => {
  const calls: RepairerAsk[] = []
  const repairer: DiagramRepairer = async (ask) => {
    calls.push(ask)
    return { outcome: await answer(ask), modelRef }
  }
  return { repairer, calls }
}

const repairedNow = async (): Promise<DiagramRepairOutcome> => ({
  kind: EDiagramRepair.Repaired,
  repaired: REPAIRED,
})

const INPUT = { sessionId: 's-1', source: SOURCE, error: 'Parse error on line 2' }

describe('DiagramRepairService', () => {
  it('repairs once and answers the stored outcome on the second ask', async () => {
    const { db, plane } = await seed()
    const { repairer, calls } = countingRepairer(repairedNow)
    const service = new DiagramRepairService(plane, repairer)

    const first = await service.repair({ userId: 'user-1', input: INPUT })
    const second = await service.repair({ userId: 'user-1', input: INPUT })

    expect(first).toEqual({ kind: EDiagramRepair.Repaired, repaired: REPAIRED })
    expect(second).toEqual(first)
    expect(calls).toHaveLength(1)
    expect(await db.orm.public.DiagramRepair.all()).toHaveLength(1)
  })

  it('keeps a trimmed copy of the source that keys the row', async () => {
    const { db, plane } = await seed()
    const { repairer } = countingRepairer(repairedNow)
    const service = new DiagramRepairService(plane, repairer)

    await service.repair({ userId: 'user-1', input: { ...INPUT, source: `\n ${SOURCE} \n` } })

    const rows = await db.orm.public.DiagramRepair.all()
    expect(rows[0]?.source).toBe(SOURCE)
    expect(rows[0]?.modelRef).toBe('anthropic/claude-opus-4-1')
    expect(rows[0]?.repaired).toBe(REPAIRED)
  })

  it('makes one model call for two concurrent asks about the same diagram', async () => {
    const { plane } = await seed()
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const { repairer, calls } = countingRepairer(async () => {
      await held
      return await repairedNow()
    })
    const service = new DiagramRepairService(plane, repairer)

    const both = Promise.all([
      service.repair({ userId: 'user-1', input: INPUT }),
      service.repair({ userId: 'user-1', input: INPUT }),
    ])
    release()
    const [first, second] = await both

    expect(calls).toHaveLength(1)
    expect(first).toEqual(second)
  })

  it('stores a failed repair so the diagram is never asked about twice', async () => {
    const { db, plane } = await seed()
    const { repairer, calls } = countingRepairer(async () => ({
      kind: EDiagramRepair.Failed,
      reason: 'the model returned the diagram unchanged',
    }))
    const service = new DiagramRepairService(plane, repairer)

    const outcome = await service.repair({ userId: 'user-1', input: INPUT })
    await service.repair({ userId: 'user-1', input: INPUT })

    expect(outcome).toEqual({
      kind: EDiagramRepair.Failed,
      reason: 'the model returned the diagram unchanged',
    })
    expect(calls).toHaveLength(1)
    const rows = await db.orm.public.DiagramRepair.all()
    expect(rows[0]?.reason).toBe('the model returned the diagram unchanged')
    expect(rows[0]?.repaired).toBeNull()
  })

  it('stores nothing when the repairer throws', async () => {
    const { db, plane } = await seed()
    const { repairer } = countingRepairer(async () => {
      throw new Error('This request would exceed your account monthly spend limit')
    })
    const service = new DiagramRepairService(plane, repairer)

    const outcome = await service.repair({ userId: 'user-1', input: INPUT })

    expect(outcome).toEqual({
      kind: EDiagramRepair.Failed,
      reason: 'This request would exceed your account monthly spend limit',
    })
    expect(await db.orm.public.DiagramRepair.all()).toHaveLength(0)
  })

  it('refuses a session that belongs to another user', async () => {
    const { plane } = await seed()
    const { repairer, calls } = countingRepairer(repairedNow)
    const service = new DiagramRepairService(plane, repairer)

    expect(service.repair({ userId: 'user-2', input: INPUT })).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(calls).toHaveLength(0)
  })

  it('lists the repairs a session has stored', async () => {
    const { plane } = await seed()
    const { repairer } = countingRepairer(async (ask) =>
      ask.source === SOURCE
        ? { kind: EDiagramRepair.Repaired, repaired: REPAIRED }
        : { kind: EDiagramRepair.Failed, reason: 'the model returned no diagram' },
    )
    const service = new DiagramRepairService(plane, repairer)
    await service.repair({ userId: 'user-1', input: INPUT })
    await service.repair({
      userId: 'user-1',
      input: { ...INPUT, source: 'flowchart LR\n A --> B' },
    })

    const listed = await service.list({ userId: 'user-1', input: { sessionId: 's-1' } })

    expect(listed.repairs).toEqual([
      { source: SOURCE, outcome: { kind: EDiagramRepair.Repaired, repaired: REPAIRED } },
      {
        source: 'flowchart LR\n A --> B',
        outcome: { kind: EDiagramRepair.Failed, reason: 'the model returned no diagram' },
      },
    ])
  })

  it('refuses to list another user session', async () => {
    const { plane } = await seed()
    const { repairer } = countingRepairer(repairedNow)
    const service = new DiagramRepairService(plane, repairer)

    expect(service.list({ userId: 'user-2', input: { sessionId: 's-1' } })).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })
})
