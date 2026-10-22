import { db } from '@dltech/atlas-db'
import { seedOrganization, useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { eventsOf, seedUsers, USER_A, USER_B } from '../../../../test/session-seed'
import { ThreadsService } from './threads.service'

describe('ThreadsService owner', () => {
  useTestDatabase()
  let service: ThreadsService

  beforeEach(async () => {
    await seedUsers(USER_A, USER_B)
    service = new ThreadsService()
  })

  it('create stores the project workspace as the thread owner, and null for a personal project', async () => {
    await seedOrganization({ db, id: 'org_1', memberIds: [USER_A] })
    await db.orm.public.Project.create({ id: 'prj_ws', name: 'ws', organizationId: 'org_1' })
    await db.orm.public.Project.create({ id: 'prj_me', name: 'me', ownerUserId: USER_A })

    const workspace = await service.create({ userId: USER_A, draft: { projectId: 'prj_ws' } })
    const personal = await service.create({ userId: USER_A, draft: { projectId: 'prj_me' } })
    const bare = await service.create({ userId: USER_A, draft: {} })

    const owner = async (id: string) =>
      (await db.orm.public.Thread.first({ id }))?.organizationId ?? null
    expect(await owner(workspace.id)).toBe('org_1')
    expect(await owner(personal.id)).toBeNull()
    expect(await owner(bare.id)).toBeNull()
    expect(workspace.projectId).toBe('prj_ws')
    expect(bare.projectId).toBeNull()
    expect(await eventsOf(workspace.id)).toHaveLength(0)
    expect(await db.orm.public.CloudSandbox.all()).toHaveLength(0)
  })
})
