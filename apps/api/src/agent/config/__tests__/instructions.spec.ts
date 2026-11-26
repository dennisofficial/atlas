import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import { instructionsPort } from '../instructions'
import { seedGroup, seedOwner } from './config-reader.fixture'

const testDb = useTestDatabase()

describe('instructionsPort', () => {
  it('reads the personal document and the group document of the session project', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGroup(db)
    await db.orm.public.UserFile.create({
      userId: 'user-1',
      tree: 'instructions',
      path: '.atlas/ATLAS.md',
      revision: 1,
      contentHash: 'h',
      content: Buffer.from('be brief'),
    })
    await db.orm.public.GroupInstruction.create({
      groupId: 'grp-1',
      content: 'the group ships on Fridays',
    })

    const port = instructionsPort({ db })

    expect(await port.personal('s-1')).toBe('be brief')
    expect(await port.group('s-1')).toBe('the group ships on Fridays')
  })

  it('answers null when the project has no group or the document is blank', async () => {
    const { db } = testDb()
    await seedOwner(db)

    expect(await instructionsPort({ db }).group('s-1')).toBeNull()

    await seedGroup(db)
    await db.orm.public.GroupInstruction.create({ groupId: 'grp-1', content: '   ' })

    expect(await instructionsPort({ db }).group('s-1')).toBeNull()
  })

  it('answers null for a session that does not exist', async () => {
    const { db } = testDb()

    expect(await instructionsPort({ db }).group('nope')).toBeNull()
    expect(await instructionsPort({ db }).personal('nope')).toBeNull()
  })
})
