import { useTestDatabase } from '@dltech/atlas-db/testing'
import { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import { describe, expect, it } from 'bun:test'

import { personalConfigClientOf } from '../cloud-config-personal'
import { projectConfigClientOf } from '../cloud-config-project'
import { seedOwner } from './config-reader.fixture'

const testDb = useTestDatabase()

const PROJECT = 'proj-1'
const USER = 'user-1'

const clientsOf = async () => {
  const { db } = testDb()
  await seedOwner(db)
  const cipher = new SecretCipher('a'.repeat(64))
  return {
    db,
    project: projectConfigClientOf({ db, cipher, projectId: PROJECT }),
    personal: personalConfigClientOf({ db, cipher, userId: USER }),
  }
}

describe('cloud config store keeps every member in a grant', () => {
  it('refuses a new project secret that names no grant', async () => {
    const { project } = await clientsOf()

    await expect(project.setSecret({ name: 'API_TOKEN', value: 'one' })).rejects.toThrow(
      'name the grant this secret belongs to (grant: ...)',
    )
  })

  it('refuses a secret whose grant does not exist', async () => {
    const { project } = await clientsOf()

    await expect(
      project.setSecret({ name: 'API_TOKEN', value: 'one', grant: 'PlanetScale' }),
    ).rejects.toThrow('no grant named PlanetScale; create it with kind grant')
  })

  it('keeps a project secret in its grant on a re-set and lists the grant', async () => {
    const { project } = await clientsOf()
    await project.setGrant({ name: 'PlanetScale', instruction: 'Database work.' })

    await project.setSecret({ name: 'API_TOKEN', value: 'one', grant: 'PlanetScale' })
    await project.setSecret({ name: 'API_TOKEN', value: 'two' })

    expect(await project.listSecrets()).toEqual([{ name: 'API_TOKEN', grant: 'PlanetScale' }])
    expect(await project.listGrants()).toEqual([
      {
        name: 'PlanetScale',
        instruction: 'Database work.',
        secrets: ['API_TOKEN'],
        files: [],
      },
    ])
  })

  it('keeps the emptied grant a moved member leaves behind', async () => {
    const { db, project } = await clientsOf()
    await project.setGrant({ name: 'Scratch' })
    await project.setGrant({ name: 'PlanetScale', instruction: 'Database work.' })
    await project.setSecret({ name: 'API_TOKEN', value: 'one', grant: 'Scratch' })

    await project.setSecret({ name: 'API_TOKEN', value: 'two', grant: 'PlanetScale' })

    const grants = await db.orm.public.ProjectAccessGrant.where({ projectId: PROJECT }).all()
    expect(grants.map((grant) => grant.name).sort()).toEqual(['PlanetScale', 'Scratch'])
    expect((await project.listGrants()).find((grant) => grant.name === 'Scratch')).toEqual({
      name: 'Scratch',
      instruction: '',
      secrets: [],
      files: [],
    })
  })

  it('renames a project grant and refuses a taken name', async () => {
    const { project } = await clientsOf()
    await project.setGrant({ name: 'PlanetScale' })
    await project.setGrant({ name: 'Other' })

    await expect(project.setGrant({ name: 'PlanetScale', newName: 'Other' })).rejects.toThrow(
      'a grant named Other already exists',
    )

    await project.setGrant({ name: 'PlanetScale', newName: 'Databases' })
    expect((await project.listGrants()).map((grant) => grant.name)).toEqual(['Databases', 'Other'])
  })

  it('deletes a project grant with its members', async () => {
    const { db, project } = await clientsOf()
    await project.setGrant({ name: 'PlanetScale' })
    await project.setSecret({ name: 'API_TOKEN', value: 'one', grant: 'PlanetScale' })
    await project.setFileMount({
      path: '.env.keys',
      contents: 'x',
      mode: 0o600,
      grant: 'PlanetScale',
    })

    expect(await project.removeGrant('PlanetScale')).toBe(true)

    expect(await db.orm.public.ProjectSecret.where({ projectId: PROJECT }).all()).toEqual([])
    expect(await db.orm.public.ProjectFileMount.where({ projectId: PROJECT }).all()).toEqual([])
  })

  it('sets and reads a personal secret in its grant', async () => {
    const { db, personal } = await clientsOf()
    await personal.setGrant({ name: 'PlanetScale', instruction: 'Database work.' })
    await personal.setSecret({ name: 'API_TOKEN', value: 'one', grant: 'PlanetScale' })

    expect(await personal.listSecrets()).toEqual([{ name: 'API_TOKEN', grant: 'PlanetScale' }])
    const row = await db.orm.public.UserSecret.where({ userId: USER, name: 'API_TOKEN' }).first()
    expect(row?.sealedValue).not.toContain('one')
  })

  it('refuses a new personal file outside ~/ and @/', async () => {
    const { personal } = await clientsOf()
    await personal.setGrant({ name: 'Config' })

    await expect(
      personal.setFileMount({
        path: 'apps/api/.env.keys',
        contents: 'x',
        mode: 0o600,
        grant: 'Config',
      }),
    ).rejects.toThrow('Start the path with ~/ or @/')

    await personal.setFileMount({
      path: '~/.config/atlas.env',
      contents: 'x',
      mode: 0o600,
      grant: 'Config',
    })
    expect(await personal.listFileMounts()).toEqual([
      { path: '~/.config/atlas.env', mode: 0o600, grant: 'Config' },
    ])
  })

  it('round trips a personal setting', async () => {
    const { personal } = await clientsOf()

    await personal.setSetting({ key: 'model.fast', stored: 'atlas-setting:v1:true' })

    expect(await personal.readSetting('model.fast')).toEqual({
      key: 'model.fast',
      value: 'atlas-setting:v1:true',
    })
    expect(await personal.removeSetting('model.fast')).toBe(true)
    expect(await personal.readSetting('model.fast')).toBeNull()
  })
})
