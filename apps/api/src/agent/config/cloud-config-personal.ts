import { randomUUID } from 'node:crypto'

import type { Db, Tx } from '@dltech/atlas-db'
import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import { EAccessScope, personalFileMountPathProblem } from '@dltech/atlas-wire/web'
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

const personalGrantIdOf = async (args: {
  tx: Tx
  userId: string
  name: string | undefined
  current: string | undefined
  member: 'secret' | 'file'
}): Promise<string> => {
  if (args.name !== undefined) {
    const row = await args.tx.orm.public.UserAccessGrant.where({
      userId: args.userId,
      name: args.name.trim(),
    }).first()
    if (row === null) throw new Error(noGrantNamed(args.name.trim()))
    return row.id
  }
  if (args.current !== undefined) return args.current
  throw new Error(grantRequired(args.member))
}

export const personalConfigClientOf = (args: {
  db: Db
  cipher: SecretCipher
  userId: string
}): CloudConfigClient => {
  const { db, cipher, userId } = args
  const settings = db.orm.public.UserSetting
  const secrets = db.orm.public.UserSecret
  const mounts = db.orm.public.UserFileMount
  const grants = db.orm.public.UserAccessGrant
  const grantNamesOf = async (): Promise<Map<string, string>> =>
    new Map(
      (await grants.select('id', 'name').where({ userId }).all()).map((row) => [row.id, row.name]),
    )

  return {
    scope: EAccessScope.Personal,
    listSettings: async () =>
      (
        await settings
          .where({ userId })
          .orderBy((row) => row.key.asc())
          .all()
      ).map((row) => ({
        key: row.key,
        value: row.value,
      })),
    readSetting: async (key) => {
      const row = await settings.where({ userId, key }).first()
      return row === null ? null : { key: row.key, value: row.value }
    },
    setSetting: async ({ key, stored }) => {
      await settings.upsert({
        conflictOn: { userId, key },
        create: { id: `set_${randomUUID()}`, userId, key, value: stored },
        update: { value: stored },
      })
    },
    removeSetting: async (key) => (await settings.where({ userId, key }).deleteAndCount()) > 0,
    listSecrets: async () => {
      const [rows, names] = await Promise.all([
        secrets
          .where({ userId })
          .orderBy((row) => row.name.asc())
          .all(),
        grantNamesOf(),
      ])
      return rows.map((row) => ({ name: row.name, grant: names.get(row.grantId) ?? '' }))
    },
    setSecret: async ({ name, value, grant }) => {
      const problem = envNameProblem(name)
      if (problem !== undefined) throw new Error(problem)
      const sealedValue = sealedOf({ cipher, value })
      await db.transaction(async (tx) => {
        const rows = tx.orm.public.UserSecret
        const existing = await rows.where({ userId, name }).first()
        const grantId = await personalGrantIdOf({
          tx,
          userId,
          name: grant,
          current: existing === null ? undefined : existing.grantId,
          member: 'secret',
        })
        if (existing === null) {
          await rows.create({ id: `usec_${randomUUID()}`, userId, grantId, name, sealedValue })
          return
        }
        await rows.where({ userId, name }).update({ sealedValue, grantId })
      })
    },
    moveSecret: async ({ name, grant }) =>
      db.transaction(async (tx) => {
        const rows = tx.orm.public.UserSecret
        const existing = await rows.where({ userId, name }).first()
        if (existing === null) return false
        const grantId = await personalGrantIdOf({
          tx,
          userId,
          name: grant,
          current: existing.grantId,
          member: 'secret',
        })
        if (existing.grantId === grantId) return true
        await rows.where({ userId, name }).update({ grantId })
        return true
      }),
    removeSecret: async (name) => {
      const problem = envNameProblem(name)
      if (problem !== undefined) throw new Error(problem)
      return db.transaction(async (tx) => {
        const row = await tx.orm.public.UserSecret.where({ userId, name }).first()
        if (row === null) return false
        await tx.orm.public.UserSecret.where({ userId, name }).deleteAndCount()
        return true
      })
    },
    listFileMounts: async () => {
      const [rows, names] = await Promise.all([
        mounts
          .where({ userId })
          .orderBy((row) => row.path.asc())
          .all(),
        grantNamesOf(),
      ])
      return rows.map((row) => ({
        path: row.path,
        mode: row.mode,
        grant: names.get(row.grantId) ?? '',
      }))
    },
    setFileMount: async ({ path, contents, mode, grant }) => {
      const pathProblem = personalFileMountPathProblem(path)
      if (pathProblem !== null) throw new Error(pathProblem)
      const sealedContents = sealedOf({ cipher, value: contents })
      await db.transaction(async (tx) => {
        const rows = tx.orm.public.UserFileMount
        const existing = await rows.where({ userId, path }).first()
        const grantId = await personalGrantIdOf({
          tx,
          userId,
          name: grant,
          current: existing === null ? undefined : existing.grantId,
          member: 'file',
        })
        if (existing === null) {
          await rows.create({
            id: `ufm_${randomUUID()}`,
            userId,
            grantId,
            path,
            sealedContents,
            mode,
          })
          return
        }
        await rows.where({ userId, path }).update({ sealedContents, mode, grantId })
      })
    },
    removeFileMount: async (path) =>
      db.transaction(async (tx) => {
        const row = await tx.orm.public.UserFileMount.where({ userId, path }).first()
        if (row === null) return false
        await tx.orm.public.UserFileMount.where({ userId, path }).deleteAndCount()
        return true
      }),
    moveFileMount: async ({ path, grant }) =>
      db.transaction(async (tx) => {
        const rows = tx.orm.public.UserFileMount
        const existing = await rows.where({ userId, path }).first()
        if (existing === null) return false
        const grantId = await personalGrantIdOf({
          tx,
          userId,
          name: grant,
          current: existing.grantId,
          member: 'file',
        })
        if (existing.grantId === grantId) return true
        await rows.where({ userId, path }).update({ grantId })
        return true
      }),
    listGrants: async () => {
      const [rows, secretRows, mountRows] = await Promise.all([
        grants
          .where({ userId })
          .orderBy((row) => row.name.asc())
          .all(),
        secrets.where({ userId }).all(),
        mounts.where({ userId }).all(),
      ])
      return rows.map((row) => grantViewOf({ grant: row, secrets: secretRows, files: mountRows }))
    },
    readGrant: async (name) => {
      const row = await grants.where({ userId, name: name.trim() }).first()
      if (row === null) return null
      const [secretRows, mountRows] = await Promise.all([
        secrets.where({ userId }).all(),
        mounts.where({ userId }).all(),
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
      await db.transaction(async (tx) => {
        const rows = tx.orm.public.UserAccessGrant
        const existing = await rows.where({ userId, name: name.trim() }).first()
        if (existing === null) {
          if (newName !== undefined) throw new Error(noGrantNamed(name))
          await rows.create({
            id: `uag_${randomUUID()}`,
            userId,
            name: name.trim(),
            instruction: instruction ?? '',
          })
          return
        }
        const update = grantUpdateOf({ existing, instruction, newName })
        if (update.name !== existing.name) {
          const clash = await rows.where({ userId, name: update.name }).first()
          if (clash !== null) throw new Error(`a grant named ${update.name} already exists`)
        }
        await rows.where({ userId, name: existing.name }).update(update)
      })
    },
    removeGrant: async (name) =>
      (await grants.where({ userId, name: name.trim() }).deleteAndCount()) > 0,
  }
}
