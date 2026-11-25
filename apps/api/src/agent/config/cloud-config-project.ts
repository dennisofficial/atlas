import { randomUUID } from 'node:crypto'

import type { Db, Tx } from '@dltech/atlas-db'
import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import { EAccessScope } from '@dltech/atlas-wire/web'

import { cleanupProjectGrant } from '../../_lib/access-grants/grant-of-one'
import {
  grantInstructionProblem,
  grantNameProblem,
  grantRequired,
  grantUpdateOf,
  grantViewOf,
  noGrantNamed,
} from './cloud-config-grants'
import { mcpConfigClientOf } from './cloud-config-mcp'
import { envNameProblem, sealedOf } from './cloud-config-seal'
import type { ProjectCloudConfigClient } from './cloud-config-store'

const projectGrantIdOf = async (args: {
  tx: Tx
  projectId: string
  name: string | undefined
  current: string | undefined
  member: 'secret' | 'file'
}): Promise<string> => {
  if (args.name !== undefined) {
    const row = await args.tx.orm.public.ProjectAccessGrant.where({
      projectId: args.projectId,
      name: args.name.trim(),
    }).first()
    if (row === null) throw new Error(noGrantNamed(args.name.trim()))
    return row.id
  }
  if (args.current !== undefined) return args.current
  throw new Error(grantRequired(args.member))
}

export const projectConfigClientOf = (args: {
  db: Db
  cipher: SecretCipher
  projectId: string
}): ProjectCloudConfigClient => {
  const { db, cipher, projectId } = args
  const settings = db.orm.public.ProjectSetting
  const secrets = db.orm.public.ProjectSecret
  const mounts = db.orm.public.ProjectFileMount
  const grants = db.orm.public.ProjectAccessGrant
  const grantNamesOf = async (): Promise<Map<string, string>> =>
    new Map(
      (await grants.select('id', 'name').where({ projectId }).all()).map((row) => [
        row.id,
        row.name,
      ]),
    )

  return {
    ...mcpConfigClientOf({ db, cipher, projectId }),
    scope: EAccessScope.Project,
    listSettings: async () =>
      (
        await settings
          .where({ projectId })
          .orderBy((row) => row.key.asc())
          .all()
      ).map((row) => ({
        key: row.key,
        value: row.value,
      })),
    readSetting: async (key) => {
      const row = await settings.where({ projectId, key }).first()
      return row === null ? null : { key: row.key, value: row.value }
    },
    setSetting: async ({ key, stored }) => {
      await settings.upsert({
        conflictOn: { projectId, key },
        create: { id: `pset_${randomUUID()}`, projectId, key, value: stored },
        update: { value: stored },
      })
    },
    removeSetting: async (key) => (await settings.where({ projectId, key }).deleteAndCount()) > 0,
    listSecrets: async () => {
      const [rows, names] = await Promise.all([
        secrets
          .where({ projectId })
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
        const rows = tx.orm.public.ProjectSecret
        const existing = await rows.where({ projectId, name }).first()
        const grantId = await projectGrantIdOf({
          tx,
          projectId,
          name: grant,
          current: existing === null ? undefined : existing.grantId,
          member: 'secret',
        })
        if (existing === null) {
          await rows.create({ id: `psec_${randomUUID()}`, projectId, grantId, name, sealedValue })
          return
        }
        await rows.where({ projectId, name }).update({ sealedValue, grantId })
        if (existing.grantId !== grantId) {
          await cleanupProjectGrant({ tx, projectId, grantId: existing.grantId })
        }
      })
    },
    removeSecret: async (name) => {
      const problem = envNameProblem(name)
      if (problem !== undefined) throw new Error(problem)
      return db.transaction(async (tx) => {
        const row = await tx.orm.public.ProjectSecret.where({ projectId, name }).first()
        if (row === null) return false
        await tx.orm.public.ProjectSecret.where({ projectId, name }).deleteAndCount()
        await cleanupProjectGrant({ tx, projectId, grantId: row.grantId })
        return true
      })
    },
    listFileMounts: async () => {
      const [rows, names] = await Promise.all([
        mounts
          .where({ projectId })
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
      const sealedContents = sealedOf({ cipher, value: contents })
      await db.transaction(async (tx) => {
        const rows = tx.orm.public.ProjectFileMount
        const existing = await rows.where({ projectId, path }).first()
        const grantId = await projectGrantIdOf({
          tx,
          projectId,
          name: grant,
          current: existing === null ? undefined : existing.grantId,
          member: 'file',
        })
        if (existing === null) {
          await rows.create({
            id: `pfm_${randomUUID()}`,
            projectId,
            grantId,
            path,
            sealedContents,
            mode,
          })
          return
        }
        await rows.where({ projectId, path }).update({ sealedContents, mode, grantId })
        if (existing.grantId !== grantId) {
          await cleanupProjectGrant({ tx, projectId, grantId: existing.grantId })
        }
      })
    },
    removeFileMount: async (path) =>
      db.transaction(async (tx) => {
        const row = await tx.orm.public.ProjectFileMount.where({ projectId, path }).first()
        if (row === null) return false
        await tx.orm.public.ProjectFileMount.where({ projectId, path }).deleteAndCount()
        await cleanupProjectGrant({ tx, projectId, grantId: row.grantId })
        return true
      }),
    listGrants: async () => {
      const [rows, secretRows, mountRows] = await Promise.all([
        grants
          .where({ projectId })
          .orderBy((row) => row.name.asc())
          .all(),
        secrets.where({ projectId }).all(),
        mounts.where({ projectId }).all(),
      ])
      return rows.map((row) => grantViewOf({ grant: row, secrets: secretRows, files: mountRows }))
    },
    readGrant: async (name) => {
      const row = await grants.where({ projectId, name: name.trim() }).first()
      if (row === null) return null
      const [secretRows, mountRows] = await Promise.all([
        secrets.where({ projectId }).all(),
        mounts.where({ projectId }).all(),
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
        const rows = tx.orm.public.ProjectAccessGrant
        const existing = await rows.where({ projectId, name: name.trim() }).first()
        if (existing === null) {
          if (newName !== undefined) throw new Error(noGrantNamed(name))
          await rows.create({
            id: `pag_${randomUUID()}`,
            projectId,
            name: name.trim(),
            instruction: instruction ?? '',
          })
          return
        }
        const update = grantUpdateOf({ existing, instruction, newName })
        if (update.name !== existing.name) {
          const clash = await rows.where({ projectId, name: update.name }).first()
          if (clash !== null) throw new Error(`a grant named ${update.name} already exists`)
        }
        await rows.where({ projectId, name: existing.name }).update(update)
      })
    },
    removeGrant: async (name) =>
      (await grants.where({ projectId, name: name.trim() }).deleteAndCount()) > 0,
  }
}
