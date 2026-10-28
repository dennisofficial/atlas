import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'bun:test'
import { eventsOf, seedUsers, USER_A, USER_B } from '../../../../test/session-seed'
import { ThreadsService } from './threads.service'
import { inertSignals } from './thread-signals.fixture'

describe('ThreadsService owner', () => {
  useTestDatabase()
  let service: ThreadsService

  beforeEach(async () => {
    await seedUsers(USER_A, USER_B)
    service = new ThreadsService(inertSignals())
  })

  it('create attaches an owned project and none for a bare thread', async () => {
    await db.orm.public.Project.create({ id: 'prj_me', name: 'me', ownerUserId: USER_A })

    const owned = await service.create({ userId: USER_A, draft: { projectId: 'prj_me' } })
    const bare = await service.create({ userId: USER_A, draft: {} })

    expect(owned.projectId).toBe('prj_me')
    expect(bare.projectId).toBeNull()
    expect(await eventsOf(owned.id)).toHaveLength(0)
    expect(await db.orm.public.CloudSandbox.all()).toHaveLength(0)
  })

  it("create refuses another user's project", async () => {
    await db.orm.public.Project.create({ id: 'prj_me', name: 'me', ownerUserId: USER_A })

    await expect(
      service.create({ userId: USER_B, draft: { projectId: 'prj_me' } }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})
