import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedUsers } from '../../../../test/session-seed'
import { projectReachableBy, threadProjectColumn } from './thread-project'

describe('thread project reachability', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers('owner', 'stranger')
    await db.orm.public.Project.create({
      id: 'prj_personal',
      name: 'personal',
      ownerUserId: 'owner',
    })
  })

  it('reaches a project only as its owner', async () => {
    expect(await projectReachableBy({ userId: 'owner', projectId: 'prj_personal' })).toBe(true)
    expect(await projectReachableBy({ userId: 'stranger', projectId: 'prj_personal' })).toBe(false)
  })

  it('does not reach a project that does not exist', async () => {
    expect(await projectReachableBy({ userId: 'owner', projectId: 'prj_missing' })).toBe(false)
  })

  it('answers not-found for a project the user cannot reach', async () => {
    await expect(
      threadProjectColumn({ userId: 'stranger', projectId: 'prj_personal' }),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(await threadProjectColumn({ userId: 'owner', projectId: 'prj_personal' })).toEqual({
      projectId: 'prj_personal',
    })
    expect(await threadProjectColumn({ userId: 'owner', projectId: undefined })).toEqual({})
  })
})
