import type { Db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import { UnknownThreadError } from '../src/errors'
import { threadOwnerOf } from '../src/postgres'

const currentDb = useTestDatabase()

const seedThread = async (args: {
  db: Db
  threadId: string
  repo: string | null
}): Promise<void> => {
  await seedUser({ db: args.db, id: 'usr-1' })
  await args.db.orm.public.Project.create({
    id: 'prj-1',
    name: 'prj-1',
    ownerUserId: 'usr-1',
    createdById: 'usr-1',
    repo: args.repo,
  })
  await args.db.orm.v2.V2Session.create({
    id: 'ses-1',
    userId: 'usr-1',
    projectId: 'prj-1',
    title: null,
    titledFromInboxId: null,
    mainThreadId: args.threadId,
    nextInboxId: 1,
    createdAt: new Date(),
    archivedAt: null,
    modelRef: null,
    modelEffort: null,
    modelFast: null,
    spawnedBySessionId: null,
    podSessionId: null,
  })
}

describe('threadOwnerOf', () => {
  it('resolves the session owner and its project repository', async () => {
    const { db } = currentDb()
    await seedThread({ db, threadId: 'thr-1', repo: 'dennisofficial/atlas' })

    await expect(threadOwnerOf({ handle: db, threadId: 'thr-1' })).resolves.toEqual({
      userId: 'usr-1',
      project: 'dennisofficial/atlas',
    })
  })

  it('answers a null project when the project has no repository', async () => {
    const { db } = currentDb()
    await seedThread({ db, threadId: 'thr-1', repo: null })

    await expect(threadOwnerOf({ handle: db, threadId: 'thr-1' })).resolves.toEqual({
      userId: 'usr-1',
      project: null,
    })
  })

  it('refuses a thread no session owns', async () => {
    const { db } = currentDb()
    await seedThread({ db, threadId: 'thr-1', repo: null })

    await expect(threadOwnerOf({ handle: db, threadId: 'thr-2' })).rejects.toBeInstanceOf(
      UnknownThreadError,
    )
  })
})
