import { randomUUID } from 'node:crypto'

import type { Db } from '@dltech/atlas-db'
import { mcpSpecSchema } from '@dltech/atlas-plugin-mcp/core'
import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import { EMcpServerScope } from '@dltech/atlas-wire/web'

import { sealedOf } from './cloud-config-seal'
import type { McpConfigClient, McpServerView, McpServerWrite } from './cloud-config-store'

type Owner = { projectId: string } | { groupId: string }

type ServerKey = { source: 'cloud'; name: string }

const SERVER_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

const NO_GROUP = 'this project has no group, so it has no group mcp servers'

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

  const ownerOf = async (scope: EMcpServerScope): Promise<Owner> => {
    if (scope === EMcpServerScope.Project) return { projectId }
    const project = await db.orm.public.Project.first({ id: projectId })
    const groupId = project?.groupId ?? null
    if (groupId === null) throw new Error(NO_GROUP)
    return { groupId }
  }

  const keyOf = async (args: {
    name: string
    scope: EMcpServerScope
  }): Promise<ServerKey & Owner> => ({
    ...(await ownerOf(args.scope)),
    source: 'cloud',
    name: args.name,
  })

  return {
    projectId,
    listMcpServers: async (scope = EMcpServerScope.Project) => {
      const owner = await ownerOf(scope)
      const rows = await servers
        .where({ ...owner, source: 'cloud' })
        .orderBy((row) => row.name.asc())
        .all()
      return rows.map((row) => toView({ row, cipher }))
    },
    readMcpServer: async (name, scope = EMcpServerScope.Project) => {
      const row = await servers.first(await keyOf({ name, scope }))
      return row === null ? null : toView({ row, cipher })
    },
    putMcpServer: async (server, scope = EMcpServerScope.Project) => {
      const problem = serverNameProblem(server.name)
      if (problem !== undefined) throw new Error(problem)
      const spec = {
        name: server.name,
        ...(server.transport === undefined ? {} : { transport: server.transport }),
        ...(server.disabled ? { disabled: true } : {}),
        ...(server.proxy ? { proxy: true } : {}),
      }
      const sealedSpec = sealedOf({ cipher, value: spec })
      const key = await keyOf({ name: server.name, scope })
      await servers.upsert({
        conflictOn: key,
        create: {
          id: `${scope === EMcpServerScope.Group ? 'gmcp' : 'pmcp'}_${randomUUID()}`,
          ...key,
          sealedSpec,
        },
        update: { sealedSpec },
      })
    },
    removeMcpServer: async (name, scope = EMcpServerScope.Project) => {
      const problem = serverNameProblem(name)
      if (problem !== undefined) throw new Error(problem)
      return (await servers.where(await keyOf({ name, scope })).deleteAndCount()) > 0
    },
  }
}
