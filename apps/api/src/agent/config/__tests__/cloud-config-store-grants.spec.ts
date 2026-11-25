import { useTestDatabase } from '@dltech/atlas-db/testing'
import { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import { describe, expect, it } from 'bun:test'

import { cloudConfigClientOf } from '../cloud-config-store'
import { seedOwner } from './config-reader.fixture'

const testDb = useTestDatabase()

const PROJECT = 'proj-1'

const clientOf = async () => {
  const { db } = testDb()
  await seedOwner(db)
  return {
    db,
    client: cloudConfigClientOf({
      db,
      cipher: new SecretCipher('a'.repeat(64)),
      projectId: PROJECT,
    }),
  }
}

describe('cloud config store keeps every member in a grant', () => {
  it('puts a new secret in a grant named after it and keeps that grant on a re-set', async () => {
    const { db, client } = await clientOf()

    await client.setSecret({ name: 'API_TOKEN', value: 'one' })
    await client.setSecret({ name: 'API_TOKEN', value: 'two' })

    const grants = await db.orm.public.ProjectAccessGrant.where({ projectId: PROJECT }).all()
    const secret = await db.orm.public.ProjectSecret.where({
      projectId: PROJECT,
      name: 'API_TOKEN',
    }).first()
    expect(grants.map((grant) => grant.name)).toEqual(['API_TOKEN'])
    expect(secret?.grantId).toBe(grants[0]?.id)
  })

  it('removes the grant of one with its last file', async () => {
    const { db, client } = await clientOf()

    await client.setFileMount({ path: '.env.keys', contents: 'x', mode: 0o600 })
    expect(await client.removeFileMount('.env.keys')).toBe(true)

    expect(await db.orm.public.ProjectAccessGrant.where({ projectId: PROJECT }).all()).toEqual([])
    expect(await client.removeFileMount('.env.keys')).toBe(false)
  })

  it('keeps a described grant when its last secret goes', async () => {
    const { db, client } = await clientOf()
    await client.setSecret({ name: 'API_TOKEN', value: 'one' })
    await db.orm.public.ProjectAccessGrant.where({ projectId: PROJECT }).updateAll({
      instruction: 'Read-only token.',
    })

    expect(await client.removeSecret('API_TOKEN')).toBe(true)

    expect(
      (await db.orm.public.ProjectAccessGrant.where({ projectId: PROJECT }).all()).length,
    ).toBe(1)
  })
})
