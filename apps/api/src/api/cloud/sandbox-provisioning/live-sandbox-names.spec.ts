import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { sandboxNameFor } from '../../platform/sandboxes/sandbox-names'
import { seedThreadRow, seedUsers } from '../../../../test/session-seed'
import { liveSandboxNames } from './live-sandbox-names'

const v2Session = async (args: {
  id: string
  podSessionId: string
  archivedAt?: Date
}): Promise<void> => {
  const at = new Date('2026-11-09T00:00:00Z')
  await db.orm.v2.V2Session.create({
    id: args.id,
    userId: 'user-a',
    projectId: 'prj-1',
    mainThreadId: `thr_${args.id}`,
    nextInboxId: 1,
    podSessionId: args.podSessionId,
    ...(args.archivedAt === undefined ? {} : { archivedAt: args.archivedAt }),
    createdAt: at,
  })
}

describe('liveSandboxNames', () => {
  useTestDatabase()

  it('names every unarchived cloud session and peer session, and nothing archived', async () => {
    await seedUsers('user-a')
    await seedThreadRow({ id: 'thr-live', userId: 'user-a' })
    await seedThreadRow({ id: 'thr-archived', userId: 'user-a', archivedAt: new Date() })
    await v2Session({ id: 'v2-live', podSessionId: 'ses_live' })
    await v2Session({
      id: 'v2-archived',
      podSessionId: 'ses_archived',
      archivedAt: new Date('2026-11-01T00:00:00Z'),
    })

    const names = await liveSandboxNames()

    expect(names.has(sandboxNameFor({ threadId: 'thr-live' }))).toBe(true)
    expect(names.has('atlas-v2-ses_live')).toBe(true)
    expect(names.has(sandboxNameFor({ threadId: 'thr-archived' }))).toBe(false)
    expect(names.has('atlas-v2-ses_archived')).toBe(false)
  })
})
