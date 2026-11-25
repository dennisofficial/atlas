import { randomUUID } from 'node:crypto'

import type { Db } from '@dltech/atlas-db'
import { mcpSpecSchema } from '@dltech/atlas-plugin-mcp/core'
import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'

import { sealedOf } from './cloud-config-seal'
import type { McpConfigClient, McpServerView, McpServerWrite } from './cloud-config-store'

const SERVER_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

const serverNameProblem = (name: string): string | undefined =>
  SERVER_NAME_PATTERN.test(name)
    ? undefined
    : 'a server name holds only letters, digits, underscores and hyphens, because the model reads it verbatim in tool names'

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

export const mcpConfigClientOf = (args: {
  db: Db
  cipher: SecretCipher
  projectId: string
}): McpConfigClient => {
  const { db, cipher, projectId } = args
  const servers = db.orm.public.McpServer
  return {
    projectId,
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
      const sealedSpec = sealedOf({ cipher, value: spec })
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
  }
}
