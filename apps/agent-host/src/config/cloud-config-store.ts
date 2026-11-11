import { randomUUID } from 'node:crypto'

import { createDb, createPool, type Db } from '@dltech/atlas-db'
import { mcpSpecSchema, type McpTransport } from '@dltech/atlas-plugin-mcp/core'
import { ENV_NAME_PATTERN } from '@dltech/atlas-wire/web'

import { databaseUrlWithTls } from './database-url'
import { readAgentHostEnv } from './env'
import { SecretCipher } from './secret-cipher'

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
}

export type McpServerWrite = {
  name: string
  transport: McpTransport | undefined
  disabled: boolean
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
      await secrets.upsert({
        conflictOn: { projectId, name },
        create: { id: `psec_${randomUUID()}`, projectId, name, sealedValue },
        update: { sealedValue },
      })
    },
    removeSecret: async (name) => {
      const problem = envNameProblem(name)
      if (problem !== undefined) throw new Error(problem)
      return (await secrets.where({ projectId, name }).deleteAndCount()) > 0
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
      await mounts.upsert({
        conflictOn: { projectId, path },
        create: {
          id: `pfm_${randomUUID()}`,
          projectId,
          path,
          sealedContents,
          mode,
        },
        update: { sealedContents, mode },
      })
    },
    removeFileMount: async (path) => (await mounts.where({ projectId, path }).deleteAndCount()) > 0,
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
