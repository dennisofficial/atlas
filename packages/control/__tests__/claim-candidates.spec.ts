import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '../src/control-plane'
import { PostgresControlStore } from '../src/postgres'
import { claimableSessionIdsIn } from '../src/postgres/postgres-claim-candidates'

const testDb = useTestDatabase()

const createSession = async (args: { sessionId: string; userId: string }): Promise<void> => {
  const plane = new ControlPlane({ store: new PostgresControlStore(testDb().db) })
  await plane.createSession({
    sessionId: args.sessionId,
    userId: args.userId,
    projectId: null,
    mainThreadId: `thread-${args.sessionId}`,
  })
}

const candidates = (): Promise<string[]> =>
  testDb().db.transaction((tx) =>
    claimableSessionIdsIn({ tx, now: new Date().toISOString(), limit: 10 }),
  )

describe('claim candidates', () => {
  it('skips the session of a deactivated user and keeps an active one', async () => {
    await seedUser({ db: testDb().db, id: 'usr-active' })
    await seedUser({ db: testDb().db, id: 'usr-waiting' })
    await testDb().db.orm.public.User.where({ id: 'usr-active' }).updateAndCount({ active: true })
    await createSession({ sessionId: 'ses-active', userId: 'usr-active' })
    await createSession({ sessionId: 'ses-waiting', userId: 'usr-waiting' })

    const ids = await candidates()

    expect(ids).toContain('ses-active')
    expect(ids).not.toContain('ses-waiting')
  })
})
