import type { Db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { ECloudSetting } from '@dltech/atlas-plugin-sdk'
import { describe, expect, it } from 'bun:test'

import { seedOwner } from '../../config/__tests__/config-reader.fixture'
import { settingsVersionsOf } from '../settings-versions'

const testDb = useTestDatabase()

const THREAD = 't-1'

const USER = 'user-1'

const PROJECT = 'proj-1'

const versionOf = (args: { count: number; touchedAt: Date | null }): string =>
  `${args.count}:${args.touchedAt?.getTime() ?? 0}`

const seedSkill = async (args: { db: Db; name: string; owner: 'user' | 'project' }) =>
  await args.db.orm.public.Skill.create({
    name: args.name,
    description: `${args.name} description`,
    ...(args.owner === 'user' ? { userId: USER } : { projectId: PROJECT }),
  })

const seedMcp = async (args: {
  db: Db
  name: string
  owner?: 'user' | 'project'
  source?: 'cloud' | 'repo'
  oauthUpdatedAt?: Date
}) =>
  await args.db.orm.public.McpServer.create({
    id: `srv-${args.name}`,
    name: args.name,
    source: args.source ?? 'cloud',
    ...(args.source === 'repo'
      ? { repoUrl: 'https://mcp.example.com/mcp', lastSeenAt: new Date() }
      : { sealedSpec: 'sealed' }),
    ...(args.owner === 'project' ? { projectId: PROJECT } : { userId: USER }),
    ...(args.oauthUpdatedAt === undefined
      ? {}
      : {
          oauthStatus: 'active',
          oauthSealed: 'sealed',
          oauthServerUrl: 'https://mcp.example.com/mcp',
          oauthUpdatedAt: args.oauthUpdatedAt,
        }),
  })

const seedInstructions = async (args: { db: Db; path?: string; userId?: string }) =>
  await args.db.orm.public.UserFile.create({
    userId: args.userId ?? USER,
    tree: 'instructions',
    path: args.path ?? '.atlas/ATLAS.md',
    revision: 1,
    contentHash: 'h',
    content: Buffer.from('# atlas'),
  })

const versionsOf = async (db: Db) => await settingsVersionsOf({ db, threadId: THREAD })

describe('settingsVersionsOf', () => {
  it('versions each setting from the rows of the thread owner', async () => {
    const { db } = testDb()
    await seedOwner(db)
    const userSkill = await seedSkill({ db, name: 'one', owner: 'user' })
    const projectSkill = await seedSkill({ db, name: 'two', owner: 'project' })
    const server = await seedMcp({ db, name: 'docs' })
    const file = await seedInstructions({ db })

    const versions = await versionsOf(db)

    expect(versions).toEqual({
      [ECloudSetting.McpServers]: versionOf({ count: 1, touchedAt: server.updatedAt }),
      [ECloudSetting.Skills]: versionOf({
        count: 2,
        touchedAt: new Date(
          Math.max(userSkill.updatedAt.getTime(), projectSkill.updatedAt.getTime()),
        ),
      }),
      [ECloudSetting.PersonalInstructions]: versionOf({ count: 1, touchedAt: file.updatedAt }),
    })
  })

  it('answers the same version twice while nothing changed', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedSkill({ db, name: 'one', owner: 'user' })
    await seedMcp({ db, name: 'docs' })
    await seedInstructions({ db })

    expect(await versionsOf(db)).toEqual(await versionsOf(db))
  })

  it('changes the skills version when a skill goes away', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedSkill({ db, name: 'one', owner: 'user' })
    const doomed = await seedSkill({ db, name: 'two', owner: 'user' })
    const before = await versionsOf(db)

    await db.orm.public.Skill.where({ id: doomed.id }).delete()
    const after = await versionsOf(db)

    expect(after[ECloudSetting.Skills]).not.toBe(before[ECloudSetting.Skills])
    expect(after[ECloudSetting.Skills].startsWith('1:')).toBe(true)
    expect(after[ECloudSetting.McpServers]).toBe(before[ECloudSetting.McpServers])
    expect(after[ECloudSetting.PersonalInstructions]).toBe(
      before[ECloudSetting.PersonalInstructions],
    )
  })

  it('changes the mcp version when a sign-in finishes', async () => {
    const { db } = testDb()
    await seedOwner(db)
    const plain = await seedMcp({ db, name: 'docs' })
    const signedInAt = new Date(plain.updatedAt.getTime() + 60_000)
    const granted = await seedMcp({ db, name: 'posthog', oauthUpdatedAt: signedInAt })

    const versions = await versionsOf(db)

    expect(versions[ECloudSetting.McpServers]).toBe(
      versionOf({ count: 2, touchedAt: granted.oauthUpdatedAt }),
    )
  })

  it('leaves out another user, repo-sourced servers and other files', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await db.orm.public.User.create({ id: 'user-2', name: 'v', email: 'v@test.local' })
    await db.orm.public.Skill.create({ name: 'theirs', description: 'd', userId: 'user-2' })
    await seedMcp({ db, name: 'swept', source: 'repo' })
    await seedInstructions({ db, path: '.atlas/OTHER.md' })

    const versions = await versionsOf(db)

    expect(versions).toEqual({
      [ECloudSetting.McpServers]: versionOf({ count: 0, touchedAt: null }),
      [ECloudSetting.Skills]: versionOf({ count: 0, touchedAt: null }),
      [ECloudSetting.PersonalInstructions]: versionOf({ count: 0, touchedAt: null }),
    })
  })
})
