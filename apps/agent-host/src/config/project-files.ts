import { createDb, createPool, type Db } from '@dltech/atlas-db'
import type { ScopedFileMount } from '@dltech/atlas-wire/web'

import { databaseUrlWithTls } from './database-url'
import { readAgentHostEnv } from './env'
import { SecretCipher } from './secret-cipher'

const QUERY_TIMEOUT_MS = 10_000

export type SealedFileMountRow = { path: string; sealedContents: string; mode: number }

export type ProjectFileRows = {
  mounts(args: { projectId: string }): Promise<readonly SealedFileMountRow[]>
}

export type ProjectFilesSource = {
  read(args: { projectId: string }): Promise<readonly ScopedFileMount[]>
}

const openedContents = (args: { cipher: SecretCipher; sealed: string }): string | undefined => {
  try {
    const parsed: unknown = JSON.parse(args.cipher.decrypt(args.sealed))
    return typeof parsed === 'string' ? parsed : undefined
  } catch {
    return undefined
  }
}

export const readProjectFiles = async (args: {
  rows: ProjectFileRows
  cipher: SecretCipher
  projectId: string
}): Promise<readonly ScopedFileMount[]> =>
  (await args.rows.mounts({ projectId: args.projectId })).flatMap((row) => {
    const contents = openedContents({ cipher: args.cipher, sealed: row.sealedContents })
    return contents === undefined
      ? []
      : [{ path: row.path, contents, mode: row.mode } satisfies ScopedFileMount]
  })

export const projectFilesSourceOf = (): ProjectFilesSource => {
  let opened: { db: Db; cipher: SecretCipher } | undefined
  const connection = (): { db: Db; cipher: SecretCipher } => {
    if (opened !== undefined) return opened
    const env = readAgentHostEnv()
    opened = {
      db: createDb(
        createPool(databaseUrlWithTls(env.databaseUrl), { queryTimeoutMs: QUERY_TIMEOUT_MS }),
      ),
      cipher: new SecretCipher(env.secretsEncryptionKey),
    }
    return opened
  }
  return {
    read: async (args) => {
      const { db, cipher } = connection()
      return await readProjectFiles({
        rows: {
          mounts: async (lookup) =>
            await db.orm.public.ProjectFileMount.where({ projectId: lookup.projectId })
              .orderBy((row) => row.path.asc())
              .all(),
        },
        cipher,
        projectId: args.projectId,
      })
    },
  }
}
