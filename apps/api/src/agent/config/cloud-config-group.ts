import { randomUUID } from 'node:crypto'

import type { Db, Tx } from '@dltech/atlas-db'
import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import { EAccessScope } from '@dltech/atlas-wire/web'

import { cleanupGroupGrant } from '../../_lib/access-grants/grant-of-one'
import {
  grantInstructionProblem,
  grantNameProblem,
  grantRequired,
  grantUpdateOf,
  grantViewOf,
  noGrantNamed,
} from './cloud-config-grants'
import { envNameProblem, sealedOf } from './cloud-config-seal'
import type { CloudConfigClient } from './cloud-config-store'

const NO_GROUP =
  'this session’s project belongs to no group; assign the project to a group first or use scope project'

const groupGrantIdOf = async (args: {
  tx: Tx
  groupId: string
  name: string | undefined
  current: string | undefined
  member: 'secret' | 'file'
}): Promise<string> => {
  if (args.name !== undefined) {
    const row = await args.tx.orm.public.GroupAccessGrant.where({
      groupId: args.groupId,
      name: args.name.trim(),
    }).first()
    if (row === null) throw new Error(noGrantNamed(args.name.trim()))
    return row.id
  }
  if (args.current !== undefined) return args.current
  throw new Error(grantRequired(args.member))
}

export const groupConfigClientOf = (args: {
  db: Db
  cipher: SecretCipher
  projectId: string
}): CloudConfigClient => {
  const { db, cipher, projectId } = args
  const settings = db.orm.public.GroupSetting
  const secrets = db.orm.public.GroupSecret
  const mounts = db.orm.public.GroupFileMount
  const grants = db.orm.public.GroupAccessGrant
  const groupIdOf = async (): Promise<string> => {
    const project = await db.orm.public.Project.first({ id: projectId })
    const groupId = project === null ? null : project.groupId
    if (groupId === null) throw new Error(NO_GROUP)
    return groupId
  }
  const grantNamesOf = async (groupId: string): Promise<Map<string, string>> =>
    new Map(
      (await grants.select('id', 'name').where({ groupId }).all()).map((row) => [row.id, row.name]),
    )

  return {
    scope: EAccessScope.Group,
    listSettings: async () =>
      (
        await settings
          .where({ groupId: await groupIdOf() })
          .orderBy((row) => row.key.asc())
          .all()
      ).map((row) => ({ key: row.key, value: row.value })),
    readSetting: async (key) => {
      const row = await settings.where({ groupId: await groupIdOf(), key }).first()
      return row === null ? null : { key: row.key, value: row.value }
    },
    setSetting: async ({ key, stored }) => {
      const groupId = await groupIdOf()
      await settings.upsert({
        conflictOn: { groupId, key },
        create: { id: `gset_${randomUUID()}`, groupId, key, value: stored },
        update: { value: stored },
      })
    },
    removeSetting: async (key) =>
      (await settings.where({ groupId: await groupIdOf(), key }).deleteAndCount()) > 0,
    listSecrets: async () => {
      const groupId = await groupIdOf()
      const [rows, names] = await Promise.all([
        secrets
          .where({ groupId })
          .orderBy((row) => row.name.asc())
          .all(),
        grantNamesOf(groupId),
      ])
      return rows.map((row) => ({ name: row.name, grant: names.get(row.grantId) ?? '' }))
    },
    setSecret: async ({ name, value, grant }) => {
      const problem = envNameProblem(name)
      if (problem !== undefined) throw new Error(problem)
      const sealedValue = sealedOf({ cipher, value })
      const groupId = await groupIdOf()
      await db.transaction(async (tx) => {
        const rows = tx.orm.public.GroupSecret
        const existing = await rows.where({ groupId, name }).first()
        const grantId = await groupGrantIdOf({
          tx,
          groupId,
          name: grant,
          current: existing === null ? undefined : existing.grantId,
          member: 'secret',
        })
        if (existing === null) {
          await rows.create({ id: `gsec_${randomUUID()}`, groupId, grantId, name, sealedValue })
          return
        }
        await rows.where({ groupId, name }).update({ sealedValue, grantId })
        if (existing.grantId !== grantId) {
          await cleanupGroupGrant({ tx, groupId, grantId: existing.grantId })
        }
      })
    },
    removeSecret: async (name) => {
      const problem = envNameProblem(name)
      if (problem !== undefined) throw new Error(problem)
      const groupId = await groupIdOf()
      return db.transaction(async (tx) => {
        const row = await tx.orm.public.GroupSecret.where({ groupId, name }).first()
        if (row === null) return false
        await tx.orm.public.GroupSecret.where({ groupId, name }).deleteAndCount()
        await cleanupGroupGrant({ tx, groupId, grantId: row.grantId })
        return true
      })
    },
    listFileMounts: async () => {
      const groupId = await groupIdOf()
      const [rows, names] = await Promise.all([
        mounts
          .where({ groupId })
          .orderBy((row) => row.path.asc())
          .all(),
        grantNamesOf(groupId),
      ])
      return rows.map((row) => ({
        path: row.path,
        mode: row.mode,
        grant: names.get(row.grantId) ?? '',
      }))
    },
    setFileMount: async ({ path, contents, mode, grant }) => {
      const sealedContents = sealedOf({ cipher, value: contents })
      const groupId = await groupIdOf()
      await db.transaction(async (tx) => {
        const rows = tx.orm.public.GroupFileMount
        const existing = await rows.where({ groupId, path }).first()
        const grantId = await groupGrantIdOf({
          tx,
          groupId,
          name: grant,
          current: existing === null ? undefined : existing.grantId,
          member: 'file',
        })
        if (existing === null) {
          await rows.create({
            id: `gfm_${randomUUID()}`,
            groupId,
            grantId,
            path,
            sealedContents,
            mode,
          })
          return
        }
        await rows.where({ groupId, path }).update({ sealedContents, mode, grantId })
        if (existing.grantId !== grantId) {
          await cleanupGroupGrant({ tx, groupId, grantId: existing.grantId })
        }
      })
    },
    removeFileMount: async (path) => {
      const groupId = await groupIdOf()
      return db.transaction(async (tx) => {
        const row = await tx.orm.public.GroupFileMount.where({ groupId, path }).first()
        if (row === null) return false
        await tx.orm.public.GroupFileMount.where({ groupId, path }).deleteAndCount()
        await cleanupGroupGrant({ tx, groupId, grantId: row.grantId })
        return true
      })
    },
    listGrants: async () => {
      const groupId = await groupIdOf()
      const [rows, secretRows, mountRows] = await Promise.all([
        grants
          .where({ groupId })
          .orderBy((row) => row.name.asc())
          .all(),
        secrets.where({ groupId }).all(),
        mounts.where({ groupId }).all(),
      ])
      return rows.map((row) => grantViewOf({ grant: row, secrets: secretRows, files: mountRows }))
    },
    readGrant: async (name) => {
      const groupId = await groupIdOf()
      const row = await grants.where({ groupId, name: name.trim() }).first()
      if (row === null) return null
      const [secretRows, mountRows] = await Promise.all([
        secrets.where({ groupId }).all(),
        mounts.where({ groupId }).all(),
      ])
      return grantViewOf({ grant: row, secrets: secretRows, files: mountRows })
    },
    setGrant: async ({ name, instruction, newName }) => {
      const problem = grantNameProblem(name)
      if (problem !== undefined) throw new Error(problem)
      if (instruction !== undefined) {
        const instructionProblem = grantInstructionProblem(instruction)
        if (instructionProblem !== undefined) throw new Error(instructionProblem)
      }
      const groupId = await groupIdOf()
      await db.transaction(async (tx) => {
        const rows = tx.orm.public.GroupAccessGrant
        const existing = await rows.where({ groupId, name: name.trim() }).first()
        if (existing === null) {
          if (newName !== undefined) throw new Error(noGrantNamed(name))
          await rows.create({
            id: `gag_${randomUUID()}`,
            groupId,
            name: name.trim(),
            instruction: instruction ?? '',
          })
          return
        }
        const update = grantUpdateOf({ existing, instruction, newName })
        if (update.name !== existing.name) {
          const clash = await rows.where({ groupId, name: update.name }).first()
          if (clash !== null) throw new Error(`a grant named ${update.name} already exists`)
        }
        await rows.where({ groupId, name: existing.name }).update(update)
      })
    },
    removeGrant: async (name) => {
      const groupId = await groupIdOf()
      return (await grants.where({ groupId, name: name.trim() }).deleteAndCount()) > 0
    },
  }
}
