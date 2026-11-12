import { createDb, createPool, type Db } from '@dltech/atlas-db'

import {
  exportEnvSecretsOf,
  type CloudSecret,
  type ExportedEnvSecrets,
} from '../runtime/env-secrets'
import { databaseUrlWithTls } from './database-url'
import { readAgentHostEnv } from './env'
import { SecretCipher } from './secret-cipher'

const QUERY_TIMEOUT_MS = 10_000

export type SealedSecretRow = { name: string; sealedValue: string }

export type EnvSecretRows = {
  userSecrets(args: { userId: string }): Promise<readonly SealedSecretRow[]>
  projectSecrets(args: { projectId: string }): Promise<readonly SealedSecretRow[]>
}

export type EnvSecretsSource = {
  read(args: { userId: string; projectId: string }): Promise<ExportedEnvSecrets>
}

const openedSecret = (args: {
  cipher: SecretCipher
  row: SealedSecretRow
}): CloudSecret | undefined => {
  try {
    const parsed: unknown = JSON.parse(args.cipher.decrypt(args.row.sealedValue))
    return typeof parsed === 'string' ? { name: args.row.name, value: parsed } : undefined
  } catch {
    return undefined
  }
}

const openedSecrets = (args: {
  cipher: SecretCipher
  rows: readonly SealedSecretRow[]
}): CloudSecret[] =>
  args.rows.flatMap((row) => {
    const opened = openedSecret({ cipher: args.cipher, row })
    return opened === undefined ? [] : [opened]
  })

export const readEnvSecrets = async (args: {
  rows: EnvSecretRows
  cipher: SecretCipher
  userId: string
  projectId: string
}): Promise<ExportedEnvSecrets> => {
  const [user, project] = await Promise.all([
    args.rows.userSecrets({ userId: args.userId }),
    args.rows.projectSecrets({ projectId: args.projectId }),
  ])
  return exportEnvSecretsOf({
    user: openedSecrets({ cipher: args.cipher, rows: user }),
    project: openedSecrets({ cipher: args.cipher, rows: project }),
  })
}

export const envSecretsReader = (): EnvSecretsSource => {
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
      return await readEnvSecrets({
        rows: {
          userSecrets: async (lookup) =>
            await db.orm.public.UserSecret.where({ userId: lookup.userId })
              .orderBy((row) => row.name.asc())
              .all(),
          projectSecrets: async (lookup) =>
            await db.orm.public.ProjectSecret.where({ projectId: lookup.projectId })
              .orderBy((row) => row.name.asc())
              .all(),
        },
        cipher,
        userId: args.userId,
        projectId: args.projectId,
      })
    },
  }
}
