import { createDb, createPool, type Db } from '@dltech/atlas-db'

import type {
  AccessFileRow,
  AccessGrantRow,
  AccessRows,
  AccessSecretRow,
  AccessSource,
} from './access-rows'
import { databaseUrlWithTls } from './database-url'
import type { AgentHostEnv } from './env'

const QUERY_TIMEOUT_MS = 10_000

const grantOf = (row: AccessGrantRow): AccessGrantRow => ({
  id: row.id,
  name: row.name,
  instruction: row.instruction,
})

const secretOf = (row: AccessSecretRow): AccessSecretRow => ({
  name: row.name,
  grantId: row.grantId,
})

const fileOf = (row: AccessFileRow): AccessFileRow => ({ path: row.path, grantId: row.grantId })

export const accessSourceOf = (env: Pick<AgentHostEnv, 'databaseUrl'>): AccessSource => {
  let opened: Db | undefined
  const connection = (): Db => {
    if (opened !== undefined) return opened
    opened = createDb(
      createPool(databaseUrlWithTls(env.databaseUrl), { queryTimeoutMs: QUERY_TIMEOUT_MS }),
    )
    return opened
  }
  const groupIdOf = async (args: { orm: Db['orm']['public']; projectId: string | null }) => {
    if (args.projectId === null) return null
    const project = await args.orm.Project.first({ id: args.projectId })
    return project === null ? null : project.groupId
  }
  return {
    read: async (args) => {
      const orm = connection().orm.public
      const groupId = await groupIdOf({ orm, projectId: args.projectId })
      const [
        group,
        userGrants,
        groupGrants,
        projectGrants,
        userSecrets,
        groupSecrets,
        projectSecrets,
        userFiles,
        groupFiles,
        projectFiles,
      ] = await Promise.all([
        groupId === null ? null : orm.ProjectGroup.first({ id: groupId }),
        orm.UserAccessGrant.select('id', 'name', 'instruction')
          .where({ userId: args.userId })
          .orderBy((row) => row.name.asc())
          .all(),
        groupId === null
          ? []
          : orm.GroupAccessGrant.select('id', 'name', 'instruction')
              .where({ groupId })
              .orderBy((row) => row.name.asc())
              .all(),
        args.projectId === null
          ? []
          : orm.ProjectAccessGrant.select('id', 'name', 'instruction')
              .where({ projectId: args.projectId })
              .orderBy((row) => row.name.asc())
              .all(),
        orm.UserSecret.select('name', 'grantId')
          .where({ userId: args.userId })
          .orderBy((row) => row.name.asc())
          .all(),
        groupId === null
          ? []
          : orm.GroupSecret.select('name', 'grantId')
              .where({ groupId })
              .orderBy((row) => row.name.asc())
              .all(),
        args.projectId === null
          ? []
          : orm.ProjectSecret.select('name', 'grantId')
              .where({ projectId: args.projectId })
              .orderBy((row) => row.name.asc())
              .all(),
        orm.UserFileMount.select('path', 'grantId')
          .where({ userId: args.userId })
          .orderBy((row) => row.path.asc())
          .all(),
        groupId === null
          ? []
          : orm.GroupFileMount.select('path', 'grantId')
              .where({ groupId })
              .orderBy((row) => row.path.asc())
              .all(),
        args.projectId === null
          ? []
          : orm.ProjectFileMount.select('path', 'grantId')
              .where({ projectId: args.projectId })
              .orderBy((row) => row.path.asc())
              .all(),
      ])
      return {
        group: group === null ? null : { id: group.id, name: group.name },
        userGrants: userGrants.map(grantOf),
        groupGrants: groupGrants.map(grantOf),
        projectGrants: projectGrants.map(grantOf),
        userSecrets: userSecrets.map(secretOf),
        groupSecrets: groupSecrets.map(secretOf),
        projectSecrets: projectSecrets.map(secretOf),
        userFiles: userFiles.map(fileOf),
        groupFiles: groupFiles.map(fileOf),
        projectFiles: projectFiles.map(fileOf),
      } satisfies AccessRows
    },
  }
}
