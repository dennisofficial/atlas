import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { seedThreadRow, seedUsers } from '../../../../test/session-seed'
import { applyThreadActivity } from './thread-activity'

describe('applyThreadActivity turn-end detection', () => {
  useTestDatabase()

  it('reports ended completed when a working turn goes idle completed', async () => {
    await seedUsers('usr-1')
    await seedThreadRow({ id: 'thr-1', userId: 'usr-1', working: true })
    const result = await applyThreadActivity({
      threadId: 'thr-1',
      activity: { working: false, awaiting: null, lastOutcome: 'completed' },
    })
    expect(result?.ended?.outcome).toBe('completed')
    expect(Number.isNaN(Date.parse(result?.ended?.activityAt ?? ''))).toBe(false)
  })

  it('reports ended failed when a working turn goes idle failed', async () => {
    await seedUsers('usr-1')
    await seedThreadRow({ id: 'thr-1', userId: 'usr-1', working: true })
    const result = await applyThreadActivity({
      threadId: 'thr-1',
      activity: { working: false, awaiting: null, lastOutcome: 'failed' },
    })
    expect(result?.ended?.outcome).toBe('failed')
  })

  it('does not report stopped (user action) as ended', async () => {
    await seedUsers('usr-1')
    await seedThreadRow({ id: 'thr-1', userId: 'usr-1', working: true })
    const result = await applyThreadActivity({
      threadId: 'thr-1',
      activity: { working: false, awaiting: null, lastOutcome: 'stopped' },
    })
    expect(result?.applied.lastOutcome).toBe('stopped')
    expect(result?.ended).toBeNull()
  })

  it('does not report an idle row going idle again', async () => {
    await seedUsers('usr-1')
    await seedThreadRow({ id: 'thr-1', userId: 'usr-1', working: false })
    const first = await applyThreadActivity({
      threadId: 'thr-1',
      activity: { working: false, awaiting: null, lastOutcome: 'completed' },
    })
    expect(first?.ended).toBeNull()
    const second = await applyThreadActivity({
      threadId: 'thr-1',
      activity: { working: false, awaiting: 'input' },
    })
    expect(second?.ended).toBeNull()
  })

  it('answers null for an unknown thread and for an unchanged post', async () => {
    await seedUsers('usr-1')
    expect(
      await applyThreadActivity({
        threadId: 'thr-missing',
        activity: { working: false, awaiting: null },
      }),
    ).toBeNull()
    await seedThreadRow({ id: 'thr-1', userId: 'usr-1', working: false })
    expect(
      await applyThreadActivity({
        threadId: 'thr-1',
        activity: { working: false, awaiting: null },
      }),
    ).toBeNull()
  })
})
