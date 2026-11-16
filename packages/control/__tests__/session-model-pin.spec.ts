import { describe, expect, it } from 'bun:test'

import type { Db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'

import { ControlPlane } from '../src/control-plane'
import { PostgresControlStore } from '../src/postgres'

const currentDb = useTestDatabase()

const setting = (value: string): string => `atlas-setting:v1:${JSON.stringify(value)}`

const seedProject = async ({ db }: { db: Db }): Promise<void> => {
  await seedUser({ db, id: 'usr-1' })
  await db.orm.public.Project.create({
    id: 'prj-1',
    name: 'prj-1',
    ownerUserId: 'usr-1',
    createdById: 'usr-1',
    repo: null,
  })
}

const saveUserSetting = async (args: { db: Db; key: string; value: string }): Promise<void> => {
  const existing = await args.db.orm.public.UserSetting.where({
    userId: 'usr-1',
    key: args.key,
  }).first()
  if (existing === null) {
    await args.db.orm.public.UserSetting.create({
      id: `usr-1:${args.key}`,
      userId: 'usr-1',
      key: args.key,
      value: setting(args.value),
    })
    return
  }
  await args.db.orm.public.UserSetting.where({ userId: 'usr-1', key: args.key }).update({
    value: setting(args.value),
  })
}

const modelRowOf = async ({ db, sessionId }: { db: Db; sessionId: string }) => {
  const row = await db.orm.v2.V2Session.where({ id: sessionId }).first()
  if (row === null) throw new Error(`no session ${sessionId}`)
  return { modelRef: row.modelRef, modelEffort: row.modelEffort, modelFast: row.modelFast }
}

const createSession = (args: {
  plane: ControlPlane
  sessionId: string
}): Promise<{ modelRef: string; modelEffort: string; modelFast: boolean }> =>
  args.plane.createSession({
    sessionId: args.sessionId,
    userId: 'usr-1',
    projectId: 'prj-1',
    mainThreadId: `thr-${args.sessionId}`,
  })

describe('the model pinned when a session is created', () => {
  it('pins the user default and leaves the created session alone when the default changes', async () => {
    const { db } = currentDb()
    await seedProject({ db })
    await saveUserSetting({ db, key: 'model.id', value: 'anthropic/claude-opus-5-5' })
    await saveUserSetting({ db, key: 'model.effort', value: 'high' })
    const plane = new ControlPlane({ store: new PostgresControlStore(db) })

    await createSession({ plane, sessionId: 'ses-1' })
    expect(await modelRowOf({ db, sessionId: 'ses-1' })).toEqual({
      modelRef: 'anthropic/claude-opus-5-5',
      modelEffort: 'high',
      modelFast: false,
    })

    await saveUserSetting({ db, key: 'model.id', value: 'anthropic/claude-sonnet-4-5' })
    await saveUserSetting({ db, key: 'model.effort', value: 'low' })
    await createSession({ plane, sessionId: 'ses-2' })

    expect(await modelRowOf({ db, sessionId: 'ses-1' })).toEqual({
      modelRef: 'anthropic/claude-opus-5-5',
      modelEffort: 'high',
      modelFast: false,
    })
    expect(await modelRowOf({ db, sessionId: 'ses-2' })).toEqual({
      modelRef: 'anthropic/claude-sonnet-4-5',
      modelEffort: 'low',
      modelFast: false,
    })
  })

  it('lets the project default win over the user default', async () => {
    const { db } = currentDb()
    await seedProject({ db })
    await saveUserSetting({ db, key: 'model.id', value: 'anthropic/claude-opus-5-5' })
    await db.orm.public.ProjectSetting.create({
      id: 'prj-1:model.id',
      projectId: 'prj-1',
      key: 'model.id',
      value: setting('openai/gpt-5'),
    })
    const plane = new ControlPlane({ store: new PostgresControlStore(db) })

    await createSession({ plane, sessionId: 'ses-1' })

    expect((await modelRowOf({ db, sessionId: 'ses-1' })).modelRef).toBe('openai/gpt-5')
  })
})
