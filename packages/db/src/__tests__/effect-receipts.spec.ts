import { describe, expect, it } from 'bun:test'

import type { Tx } from '../client'
import { onceByStep } from '../effect-receipts'
import { useTestDatabase } from '../testing'

const insertUser = async (params: { tx: Tx; id: string }): Promise<void> => {
  await params.tx.execute(
    params.tx.raw
      .sql`INSERT INTO "User" (id, name, email, "updatedAt") VALUES (${params.id}, ${params.id}, ${params.id}, now())`
      .affectedCount()
      .build(),
  )
}

describe('effect receipts', () => {
  const testDb = useTestDatabase()

  it('returns the first result on a replay and runs the effect once', async () => {
    const { db } = testDb()
    let runs = 0
    const run = async (tx: Tx) => {
      runs += 1
      await insertUser({ tx, id: `u${runs}` })
      return { userId: `u${runs}` }
    }
    const ordinary = {
      db,
      threadId: 't1',
      stepKey: 'call-1.1',
      decode: (result: unknown) => result as { userId: string },
      encode: (value: { userId: string }) => value,
      run,
    }

    expect(await onceByStep(ordinary)).toEqual({ userId: 'u1' })
    expect(await onceByStep(ordinary)).toEqual({ userId: 'u1' })
    expect(runs).toBe(1)
    expect(await db.orm.public.User.all()).toHaveLength(1)
    expect(await db.orm.public.EffectReceipt.all()).toHaveLength(1)
  })

  it('keeps no receipt when the effect fails, so the next attempt runs again', async () => {
    const { db } = testDb()
    let runs = 0
    const failing = {
      db,
      threadId: 't1',
      stepKey: 'call-1.1',
      decode: (result: unknown) => result as { userId: string },
      encode: (value: { userId: string }) => value,
      run: async (tx: Tx) => {
        runs += 1
        await insertUser({ tx, id: 'u1' })
        throw new Error('the effect did not finish')
      },
    }

    await expect(onceByStep(failing)).rejects.toThrow('the effect did not finish')
    expect(await db.orm.public.EffectReceipt.all()).toEqual([])
    expect(await db.orm.public.User.all()).toEqual([])

    const succeeded = await onceByStep({
      ...failing,
      run: async (tx: Tx) => {
        runs += 1
        await insertUser({ tx, id: 'u1' })
        return { userId: 'u1' }
      },
    })
    expect(succeeded).toEqual({ userId: 'u1' })
    expect(runs).toBe(2)
  })

  it('returns the winner to both halves of a concurrent duplicate', async () => {
    const { db } = testDb()
    let runs = 0
    const attempt = async (id: string) =>
      await onceByStep({
        db,
        threadId: 't1',
        stepKey: 'call-1.1',
        decode: (result: unknown) => result as { userId: string },
        encode: (value: { userId: string }) => value,
        run: async (tx: Tx) => {
          runs += 1
          await insertUser({ tx, id })
          return { userId: id }
        },
      })

    const [first, second] = await Promise.all([attempt('u1'), attempt('u2')])

    expect(first).toEqual(second)
    expect(runs).toBe(1)
    expect(await db.orm.public.User.all()).toHaveLength(1)
    expect(await db.orm.public.EffectReceipt.all()).toHaveLength(1)
  })
})
