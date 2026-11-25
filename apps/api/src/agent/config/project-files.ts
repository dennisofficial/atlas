import { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'

import { createDb, createPool, type Db } from '@dltech/atlas-db'

import type { ScopedFileMount } from '../runtime/project-files'
import { databaseUrlWithTls } from './database-url'
import { readAgentHostEnv } from './env'

const QUERY_TIMEOUT_MS = 10_000

export type SealedFileMountRow = { path: string; sealedContents: string; mode: number }

export type ProjectFileRows = {
  projectMounts(args: { projectId: string }): Promise<readonly SealedFileMountRow[]>
  userMounts(args: { userId: string }): Promise<readonly SealedFileMountRow[]>
}

export type ProjectFilesSource = {
  read(args: { userId: string; projectId: string | null }): Promise<readonly ScopedFileMount[]>
}

const openedContents = (args: { cipher: SecretCipher; sealed: string }): string | undefined => {
  try {
    const parsed: unknown = JSON.parse(args.cipher.decrypt(args.sealed))
    return typeof parsed === 'string' ? parsed : undefined
  } catch {
    return undefined
  }
}

const mountsOf = (args: {
  rows: readonly SealedFileMountRow[]
  cipher: SecretCipher
}): readonly ScopedFileMount[] =>
  args.rows.flatMap((row) => {
    const contents = openedContents({ cipher: args.cipher, sealed: row.sealedContents })
    return contents === undefined
      ? []
      : [{ path: row.path, contents, mode: row.mode } satisfies ScopedFileMount]
  })

export const mergedFileMounts = (args: {
  projectMounts: readonly ScopedFileMount[]
  userMounts: readonly ScopedFileMount[]
}): readonly ScopedFileMount[] => {
  const byPath = new Map<string, ScopedFileMount>()
  for (const mount of args.userMounts) byPath.set(mount.path, mount)
  for (const mount of args.projectMounts) byPath.set(mount.path, mount)
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path))
}

export const readProjectFiles = async (args: {
  rows: ProjectFileRows
  cipher: SecretCipher
  userId: string
  projectId: string | null
}): Promise<readonly ScopedFileMount[]> => {
  const [projectRows, userRows] = await Promise.all([
    args.projectId === null ? [] : args.rows.projectMounts({ projectId: args.projectId }),
    args.rows.userMounts({ userId: args.userId }),
  ])
  return mergedFileMounts({
    projectMounts: mountsOf({ rows: projectRows, cipher: args.cipher }),
    userMounts: mountsOf({ rows: userRows, cipher: args.cipher }),
  })
}

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
          projectMounts: async (lookup) =>
            await db.orm.public.ProjectFileMount.where({ projectId: lookup.projectId })
              .orderBy((row) => row.path.asc())
              .all(),
          userMounts: async (lookup) =>
            await db.orm.public.UserFileMount.where({ userId: lookup.userId })
              .orderBy((row) => row.path.asc())
              .all(),
        },
        cipher,
        userId: args.userId,
        projectId: args.projectId,
      })
    },
  }
}
