import { beforeEach, describe, expect, it } from 'vitest'
import { createFakeFactoryDb, uniqueViolation } from './fake-factory-db'

const WORK_ITEM = {
  id: 'fwi_1',
  repo: 'compai/atlas',
  sourceKind: 'github',
  status: 'intake',
  lastActivityAt: '2026-09-19T00:00:00.000Z',
  createdAt: '2026-09-19T00:00:00.000Z',
  updatedAt: '2026-09-19T00:00:00.000Z',
}

describe('fakeFactoryDb constraint fidelity', () => {
  const fake = createFakeFactoryDb()

  beforeEach(() => {
    fake.reset()
  })

  it('rejects a duplicate primary key with a P2002 that the dedupe guards refuse', async () => {
    await fake.db.factoryWorkItem.create({ data: WORK_ITEM })

    await expect(fake.db.factoryWorkItem.create({ data: WORK_ITEM })).rejects.toMatchObject({
      code: 'P2002',
      meta: {
        driverAdapterError: { cause: { constraint: { fields: ['id'] } } },
      },
    })
  })

  it('rolls a failed transaction back to pristine rows, not mutated ones', async () => {
    await fake.db.factoryWorkItem.create({ data: WORK_ITEM })

    await expect(
      fake.db.$transaction(async (tx) => {
        const inner = tx as typeof fake.db
        await inner.factoryWorkItem.update({
          where: { id: 'fwi_1' },
          data: { status: 'active' },
        })
        throw uniqueViolation(['id'])
      }),
    ).rejects.toMatchObject({ code: 'P2002' })

    const row = await fake.db.factoryWorkItem.findUnique({ where: { id: 'fwi_1' } })
    expect(row?.status).toBe('intake')
  })
})
