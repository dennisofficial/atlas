import { db } from '@dltech/atlas-db'
import { seedOrganization, useTestDatabase } from '@dltech/atlas-db/testing'
import { NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedUsers } from '../../../../test/session-seed'
import { projectReachableBy, threadProjectColumn } from './thread-project'

describe('thread project reachability', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers('owner', 'member', 'stranger')
    await seedOrganization({ db, id: 'org_1', memberIds: ['member'] })
    await db.orm.public.Project.create({
      id: 'prj_personal',
      name: 'personal',
      ownerUserId: 'owner',
    })
    await db.orm.public.Project.create({
      id: 'prj_workspace',
      name: 'workspace',
      organizationId: 'org_1',
    })
  })

  it('reaches a personal project only as its owner', async () => {
    expect(await projectReachableBy({ userId: 'owner', projectId: 'prj_personal' })).toBe(true)
    expect(await projectReachableBy({ userId: 'member', projectId: 'prj_personal' })).toBe(false)
  })

  it('reaches a workspace project as any member of that workspace', async () => {
    expect(await projectReachableBy({ userId: 'member', projectId: 'prj_workspace' })).toBe(true)
    expect(await projectReachableBy({ userId: 'stranger', projectId: 'prj_workspace' })).toBe(false)
    expect(await projectReachableBy({ userId: 'owner', projectId: 'prj_workspace' })).toBe(false)
  })

  it('does not reach a project that does not exist', async () => {
    expect(await projectReachableBy({ userId: 'owner', projectId: 'prj_missing' })).toBe(false)
  })

  it('answers not-found for a project the user cannot reach', async () => {
    await expect(
      threadProjectColumn({ userId: 'stranger', projectId: 'prj_workspace' }),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(await threadProjectColumn({ userId: 'member', projectId: 'prj_workspace' })).toEqual({
      projectId: 'prj_workspace',
    })
  })
})
