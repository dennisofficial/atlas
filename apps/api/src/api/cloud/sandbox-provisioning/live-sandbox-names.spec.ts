import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { sandboxNameFor } from '../../platform/sandboxes/sandbox-names'
import { seedThreadRow, seedUsers } from '../../../../test/session-seed'
import { liveSandboxNames, retirableSandboxNames, v2PodNames } from './live-sandbox-names'

const v2Session = async (args: {
  id: string
  podSessionId?: string
  archivedAt?: Date
}): Promise<void> => {
  const at = new Date('2026-11-09T00:00:00Z')
  await db.orm.v2.V2Session.create({
    id: args.id,
    userId: 'user-a',
    projectId: 'prj-1',
    mainThreadId: `thr_${args.id}`,
    nextInboxId: 1,
    ...(args.podSessionId === undefined ? {} : { podSessionId: args.podSessionId }),
    ...(args.archivedAt === undefined ? {} : { archivedAt: args.archivedAt }),
    createdAt: at,
  })
}

describe('liveSandboxNames', () => {
  useTestDatabase()

  it('names every unarchived cloud session, and nothing archived', async () => {
    await seedUsers('user-a')
    await seedThreadRow({ id: 'thr-live', userId: 'user-a' })
    await seedThreadRow({ id: 'thr-archived', userId: 'user-a', archivedAt: new Date() })

    const names = await liveSandboxNames()

    expect(names.has(sandboxNameFor({ threadId: 'thr-live' }))).toBe(true)
    expect(names.has(sandboxNameFor({ threadId: 'thr-archived' }))).toBe(false)
  })

  it('names a v2 root pod by its session id and a peer by its pod session id', async () => {
    await db.orm.public.User.create({
      id: 'user-a',
      email: 'a@example.test',
      emailVerified: false,
      name: 'A',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).catch(() => undefined)
    await v2Session({ id: 'v2-root' })
    await v2Session({ id: 'v2-peer', podSessionId: 'v2-root' })

    const names = await liveSandboxNames()

    expect(names.has('atlas-v2-v2-root')).toBe(true)
    expect(names.has('atlas-v2-v2-peer')).toBe(false)
  })

  it('lists a cloud sandbox whose session is archived as retirable, and a live one as not', async () => {
    await seedUsers('user-a')
    await seedThreadRow({ id: 'thr-live', userId: 'user-a' })
    await seedThreadRow({ id: 'thr-archived', userId: 'user-a', archivedAt: new Date() })
    for (const threadId of ['thr-live', 'thr-archived']) {
      const at = new Date('2026-11-09T00:00:00Z')
      await db.orm.public.CloudSandbox.create({
        id: `sbx_${threadId}`,
        sessionId: `ses_${threadId}`,
        userId: 'user-a',
        sandboxId: '',
        name: `atlas-thread-${threadId}`,
        region: 'iad1',
        state: 'running',
        lastActivityAt: at,
        tokenHash: `hash_${threadId}`,
        createdAt: at,
        updatedAt: at,
      })
    }

    const retirable = await retirableSandboxNames()

    expect(retirable.has('atlas-thread-thr-archived')).toBe(true)
    expect(retirable.has('atlas-thread-thr-live')).toBe(false)
  })

  it('retires a v2 pod only once every session on it is archived', async () => {
    await v2Session({ id: 'v2-a', archivedAt: new Date() })
    await v2Session({ id: 'v2-b', podSessionId: 'v2-a', archivedAt: new Date() })
    await v2Session({ id: 'v2-live' })

    const { live, retirable, sessionIdsByName } = await v2PodNames()

    expect(retirable.has('atlas-v2-v2-a')).toBe(true)
    expect(live.has('atlas-v2-v2-live')).toBe(true)
    expect(sessionIdsByName.get('atlas-v2-v2-a')).toEqual(['v2-a', 'v2-b'])
  })
})
