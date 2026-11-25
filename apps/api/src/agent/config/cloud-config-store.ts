import { randomUUID } from 'node:crypto'

import { ENV_NAME_PATTERN } from '@dltech/atlas-core'
import { createDb, createPool, type Db } from '@dltech/atlas-db'
import { mcpSpecSchema, type McpTransport } from '@dltech/atlas-plugin-mcp/core'

import { cleanupProjectGrant, createProjectGrant } from '../../_lib/access-grants/grant-of-one'
import { databaseUrlWithTls } from './database-url'
import { readAgentHostEnv } from './env'
import { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'

const QUERY_TIMEOUT_MS = 10_000

const DEFAULT_FILE_MODE = 0o600

const NAME_PROBLEM =
  'a name starts with a letter or underscore and holds letters, digits and underscores, up to 200 characters'

const SERVER_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

export type SettingRow = { key: string; value: string }

export type McpServerView = {
  name: string
  transport: McpTransport | undefined
  disabled: boolean
  proxy: boolean
}

export type McpServerWrite = {
  name: string
  transport: McpTransport | undefined
  disabled: boolean
  proxy?: boolean
}

export type FileMountView = { path: string; mode: number }

export type CloudConfigClient = {
  readonly projectId: string
  listSettings(): Promise<readonly SettingRow[]>
  readSetting(key: string): Promise<SettingRow | null>
  setSetting(args: { key: string; stored: string }): Promise<void>
  removeSetting(key: string): Promise<boolean>
  listSecretNames(): Promise<readonly string[]>
  setSecret(args: { name: string; value: string }): Promise<void>
  removeSecret(name: string): Promise<boolean>
  listMcpServers(): Promise<readonly McpServerView[]>
  readMcpServer(name: string): Promise<McpServerView | null>
  putMcpServer(server: McpServerWrite): Promise<void>
  removeMcpServer(name: string): Promise<boolean>
  listFileMounts(): Promise<readonly FileMountView[]>
  setFileMount(args: { path: string; contents: string; mode: number }): Promise<void>
  removeFileMount(path: string): Promise<boolean>
}

export type CloudConfigStore = { for(projectId: string): CloudConfigClient }

const envNameProblem = (name: string): string | undefined =>
  ENV_NAME_PATTERN.test(name) ? undefined : NAME_PROBLEM

const serverNameProblem = (name: string): string | undefined =>
  SERVER_NAME_PATTERN.test(name)
    ? undefined
    : 'a server name holds only letters, digits, underscores and hyphens, because the model reads it verbatim in tool names'

const sealed = (args: { cipher: SecretCipher; value: unknown }): string =>
  args.cipher.encrypt(JSON.stringify(args.value))

const specOf = (args: { cipher: SecretCipher; sealed: string }): McpServerWrite | null => {
  try {
    const parsed = mcpSpecSchema.safeParse(JSON.parse(args.cipher.decrypt(args.sealed)))
    return parsed.success
      ? {
          name: parsed.data.name,
          transport: parsed.data.transport,
          disabled: parsed.data.disabled === true,
          proxy: parsed.data.proxy === true,
        }
      : null
  } catch {
    return null
  }
}

const toView = (args: {
  row: { name: string; sealedSpec: string | null }
  cipher: SecretCipher
}): McpServerView => {
  const spec =
    args.row.sealedSpec === null
      ? null
      : specOf({ cipher: args.cipher, sealed: args.row.sealedSpec })
  return {
    name: args.row.name,
    transport: spec?.transport,
    disabled: spec?.disabled === true,
    proxy: spec?.proxy === true,
  }
}

export const cloudConfigClientOf = (args: {
  db: Db
  cipher: SecretCipher
  projectId: string
}): CloudConfigClient => {
  const { db, cipher, projectId } = args
  const settings = db.orm.public.ProjectSetting
  const secrets = db.orm.public.ProjectSecret
  const servers = db.orm.public.McpServer
  const mounts = db.orm.public.ProjectFileMount

  return {
    projectId,
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
    listSecretNames: async () =>
      (
        await secrets
          .where({ projectId })
          .orderBy((row) => row.name.asc())
          .all()
      ).map((row) => row.name),
    setSecret: async ({ name, value }) => {
      const problem = envNameProblem(name)
      if (problem !== undefined) throw new Error(problem)
      const sealedValue = sealed({ cipher, value })
      await db.transaction(async (tx) => {
        const rows = tx.orm.public.ProjectSecret
        const existing = await rows.where({ projectId, name }).first()
        if (existing !== null) {
          await rows.where({ projectId, name }).update({ sealedValue })
          return
        }
        const grantId = await createProjectGrant({ tx, projectId, label: name })
        await rows.create({ id: `psec_${randomUUID()}`, projectId, grantId, name, sealedValue })
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
    listMcpServers: async () =>
      (
        await servers
          .where({ projectId, source: 'cloud' })
          .orderBy((row) => row.name.asc())
          .all()
      ).map((row) => toView({ row, cipher })),
    readMcpServer: async (name) => {
      const row = await servers.where({ projectId, source: 'cloud', name }).first()
      return row === null ? null : toView({ row, cipher })
    },
    putMcpServer: async (server) => {
      const problem = serverNameProblem(server.name)
      if (problem !== undefined) throw new Error(problem)
      const spec = {
        name: server.name,
        ...(server.transport === undefined ? {} : { transport: server.transport }),
        ...(server.disabled ? { disabled: true } : {}),
        ...(server.proxy ? { proxy: true } : {}),
      }
      const sealedSpec = sealed({ cipher, value: spec })
      await servers.upsert({
        conflictOn: { projectId, source: 'cloud', name: server.name },
        create: {
          id: `pmcp_${randomUUID()}`,
          projectId,
          source: 'cloud',
          name: server.name,
          sealedSpec,
        },
        update: { sealedSpec },
      })
    },
    removeMcpServer: async (name) => {
      const problem = serverNameProblem(name)
      if (problem !== undefined) throw new Error(problem)
      return (await servers.where({ projectId, source: 'cloud', name }).deleteAndCount()) > 0
    },
    listFileMounts: async () =>
      (
        await mounts
          .where({ projectId })
          .orderBy((row) => row.path.asc())
          .all()
      ).map((row) => ({
        path: row.path,
        mode: row.mode,
      })),
    setFileMount: async ({ path, contents, mode }) => {
      const sealedContents = sealed({ cipher, value: contents })
      await db.transaction(async (tx) => {
        const rows = tx.orm.public.ProjectFileMount
        const existing = await rows.where({ projectId, path }).first()
        if (existing !== null) {
          await rows.where({ projectId, path }).update({ sealedContents, mode })
          return
        }
        const grantId = await createProjectGrant({ tx, projectId, label: path })
        await rows.create({
          id: `pfm_${randomUUID()}`,
          projectId,
          grantId,
          path,
          sealedContents,
          mode,
        })
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
  }
}

export const cloudConfigStore = (): CloudConfigStore => {
  let db: Db | undefined
  let cipher: SecretCipher | undefined
  return {
    for: (projectId) => {
      if (db === undefined || cipher === undefined) {
        const env = readAgentHostEnv()
        db = createDb(
          createPool(databaseUrlWithTls(env.databaseUrl), { queryTimeoutMs: QUERY_TIMEOUT_MS }),
        )
        cipher = new SecretCipher(env.secretsEncryptionKey)
      }
      return cloudConfigClientOf({ db, cipher, projectId })
    },
  }
}

export { DEFAULT_FILE_MODE }
