import { createDb, createPool, type Db } from '@dltech/atlas-db'

import type {
  AccessFileRow,
  AccessGrantRow,
  AccessRows,
  AccessSecretRow,
  AccessSource,
} from './access-rows'
import { databaseUrlWithTls } from './database-url'
import { readAgentHostEnv } from './env'

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

export const accessSourceOf = (): AccessSource => {
  let opened: Db | undefined
  const connection = (): Db => {
    if (opened !== undefined) return opened
    const env = readAgentHostEnv()
    opened = createDb(
      createPool(databaseUrlWithTls(env.databaseUrl), { queryTimeoutMs: QUERY_TIMEOUT_MS }),
    )
    return opened
  }
  return {
    read: async (args) => {
      const orm = connection().orm.public
      const [userGrants, projectGrants, userSecrets, projectSecrets, projectFiles] =
        await Promise.all([
          orm.UserAccessGrant.select('id', 'name', 'instruction')
            .where({ userId: args.userId })
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
          args.projectId === null
            ? []
            : orm.ProjectSecret.select('name', 'grantId')
                .where({ projectId: args.projectId })
                .orderBy((row) => row.name.asc())
                .all(),
          args.projectId === null
            ? []
            : orm.ProjectFileMount.select('path', 'grantId')
                .where({ projectId: args.projectId })
                .orderBy((row) => row.path.asc())
                .all(),
        ])
      return {
        userGrants: userGrants.map(grantOf),
        projectGrants: projectGrants.map(grantOf),
        userSecrets: userSecrets.map(secretOf),
        projectSecrets: projectSecrets.map(secretOf),
        projectFiles: projectFiles.map(fileOf),
      } satisfies AccessRows
    },
  }
}
