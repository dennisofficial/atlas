import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedEventRow, seedThreadRow, seedUsers, USER_A } from '../../../../test/session-seed'
import { seedProject } from '../../../test/web-settings.fake-db'
import { threadCheckouts } from './places'
import { linkFork } from './thread-enrichment-seeds.fixture'
import { inertSignals } from './thread-signals.fixture'
import { ThreadsService } from './threads.service'

const observe = (args: {
  threadId: string
  seq: number
  branch: string | null
  detached?: boolean
}) =>
  seedEventRow({
    threadId: args.threadId,
    seq: args.seq,
    type: 'checkout-observed',
    body: JSON.stringify({
      path: '/repo',
      branch: args.branch,
      detached: args.detached ?? false,
    }),
  })

describe('thread checkout enrichment', () => {
  useTestDatabase()
  let service: ThreadsService

  beforeEach(async () => {
    await seedUsers(USER_A)
    service = new ThreadsService(inertSignals())
  })

  it('reports the latest observation', async () => {
    await seedThreadRow({ id: 't1', workspace: '/repo' })
    await observe({ threadId: 't1', seq: 1, branch: 'main' })
    await observe({ threadId: 't1', seq: 2, branch: 'x' })

    const found = await service.find({ userId: USER_A, threadId: 't1' })

    expect(found.checkout).toEqual({
      path: '/repo',
      branch: 'x',
      detached: false,
    })
  })

  it('reports a detached observation and a non-git null branch', async () => {
    await seedThreadRow({ id: 'd1' })
    await observe({ threadId: 'd1', seq: 1, branch: null, detached: true })
    await seedThreadRow({ id: 'n1' })
    await observe({ threadId: 'n1', seq: 1, branch: null })

    const detached = await service.find({ userId: USER_A, threadId: 'd1' })
    const plain = await service.find({ userId: USER_A, threadId: 'n1' })

    expect(detached.checkout).toEqual({
      path: '/repo',
      branch: null,
      detached: true,
    })
    expect(plain.checkout).toEqual({
      path: '/repo',
      branch: null,
      detached: false,
    })
  })

  it('leaves checkout off a thread without observation or cloud base branch', async () => {
    await seedThreadRow({ id: 'bare' })

    const found = await service.find({ userId: USER_A, threadId: 'bare' })

    expect(found.checkout).toBeUndefined()
  })

  it('falls back to the project base branch for a cloud thread', async () => {
    await seedProject({ id: 'p1', ownerUserId: USER_A })
    await db.orm.public.Project.where({ id: 'p1' }).update({
      baseBranch: 'develop',
    })
    await seedThreadRow({
      id: 'c1',
      projectId: 'p1',
      executionLocation: 'cloud',
    })

    const found = await service.find({ userId: USER_A, threadId: 'c1' })

    expect(found.checkout).toEqual({
      path: null,
      branch: 'develop',
      detached: false,
    })
  })

  it('does not fall back for a local thread or a project without a base branch', async () => {
    await seedProject({ id: 'p2', ownerUserId: USER_A })
    await db.orm.public.Project.where({ id: 'p2' }).update({
      baseBranch: 'develop',
    })
    await seedThreadRow({
      id: 'l1',
      projectId: 'p2',
      executionLocation: 'local',
    })
    await seedProject({ id: 'p3', ownerUserId: USER_A })
    await seedThreadRow({
      id: 'c3',
      projectId: 'p3',
      executionLocation: 'cloud',
    })

    const local = await service.find({ userId: USER_A, threadId: 'l1' })
    const bare = await service.find({ userId: USER_A, threadId: 'c3' })

    expect(local.checkout).toBeUndefined()
    expect(bare.checkout).toBeUndefined()
  })

  it('lets an observation override the fallback', async () => {
    await seedProject({ id: 'p4', ownerUserId: USER_A })
    await db.orm.public.Project.where({ id: 'p4' }).update({
      baseBranch: 'develop',
    })
    await seedThreadRow({
      id: 'c4',
      projectId: 'p4',
      executionLocation: 'cloud',
    })
    await observe({ threadId: 'c4', seq: 1, branch: 'feature' })

    const found = await service.find({ userId: USER_A, threadId: 'c4' })

    expect(found.checkout?.branch).toBe('feature')
  })

  it('inherits from a reference fork parent up to the fork point, and an own observation stops it', async () => {
    await seedThreadRow({ id: 'base' })
    await observe({ threadId: 'base', seq: 1, branch: 'one' })
    await observe({ threadId: 'base', seq: 5, branch: 'late' })
    await seedThreadRow({ id: 'fork' })
    await linkFork({ id: 'fork', parentThreadId: 'base', forkSeq: 3 })
    await seedThreadRow({ id: 'own' })
    await linkFork({ id: 'own', parentThreadId: 'base', forkSeq: 3 })
    await observe({ threadId: 'own', seq: 1, branch: null })

    const map = await threadCheckouts({
      reader: db,
      threadIds: ['fork', 'own'],
    })

    expect(map.get('fork')?.branch).toBe('one')
    expect(map.get('own')).toEqual({
      path: '/repo',
      branch: null,
      detached: false,
    })
  })
})
