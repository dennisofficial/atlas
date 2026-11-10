import { createDb, createPool, type Db } from '@dltech/atlas-db'
import type { McpServerSource, PodMcpControl } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import {
  mcpOauthGatewayOf,
  surfaceOf,
  type McpOauthGateway,
  type McpReturnSurface,
} from '../mcp-oauth'
import { databaseUrlWithTls } from './database-url'
import { readAgentHostEnv } from './env'
import { SecretCipher } from './secret-cipher'

const QUERY_TIMEOUT_MS = 10_000

const OWNER_CACHE_LIMIT = 500

const grantSchema = z.object({
  tokens: z.object({ accessToken: z.string(), expiresAt: z.string().optional() }),
})

type Owner = { userId: string; projectId: string; surface: McpReturnSurface }

type ServerRow = {
  name: string
  source: string
  repoUrl: string | null
  oauthStatus: string | null
  oauthSealed: string | null
  oauthServerUrl: string | null
}

export type McpControlPort = { of(sessionId: string): PodMcpControl }

const freshTokenOf = (args: { cipher: SecretCipher; sealed: string }): string | undefined => {
  try {
    const grant = grantSchema.safeParse(JSON.parse(args.cipher.decrypt(args.sealed)))
    if (!grant.success) return undefined
    const { accessToken, expiresAt } = grant.data.tokens
    if (expiresAt !== undefined && Date.parse(expiresAt) <= Date.now()) return undefined
    return accessToken
  } catch {
    return undefined
  }
}

export const mcpControlOf = (args: {
  db: Db
  cipher: SecretCipher
  gateway: McpOauthGateway
}): McpControlPort => {
  const owners = new Map<string, Promise<Owner | null>>()

  const ownerFor = async (sessionId: string): Promise<Owner | null> => {
    const cached = owners.get(sessionId)
    if (cached !== undefined) return await cached
    const read = args.db.orm.v2.V2Session.first({ id: sessionId }).then((session) =>
      session === null || session === undefined
        ? null
        : {
            userId: session.userId,
            projectId: session.projectId,
            surface: surfaceOf(session.lastSurface),
          },
    )
    owners.set(sessionId, read)
    if (owners.size > OWNER_CACHE_LIMIT) {
      const oldest = owners.keys().next()
      if (!oldest.done && oldest.value !== sessionId) owners.delete(oldest.value)
    }
    return await read
  }

  const rowsFor = async (args2: {
    owner: Owner
    source: McpServerSource
    name: string
  }): Promise<readonly ServerRow[]> => {
    const servers = args.db.orm.public.McpServer
    const [user, project] = await Promise.all([
      servers.where({ userId: args2.owner.userId, source: args2.source, name: args2.name }).all(),
      servers
        .where({ projectId: args2.owner.projectId, source: args2.source, name: args2.name })
        .all(),
    ])
    return [...user, ...project]
  }

  const tokenOf = async (args2: {
    owner: Owner
    name: string
    source: McpServerSource
    url: string
  }): Promise<string | undefined> => {
    const rows = await rowsFor(args2)
    const row = rows.find(
      (candidate) => (candidate.repoUrl ?? candidate.oauthServerUrl) === args2.url,
    )
    if (row === undefined || row.oauthStatus !== 'active' || row.oauthSealed === null)
      return undefined
    const fresh = freshTokenOf({ cipher: args.cipher, sealed: row.oauthSealed })
    if (fresh !== undefined) return fresh
    const refreshed = await args.gateway.refresh({
      userId: args2.owner.userId,
      projectId: args2.owner.projectId,
      source: args2.source,
      name: args2.name,
      url: args2.url,
    })
    return refreshed.ok ? refreshed.accessToken : undefined
  }

  const controlOf = (sessionId: string): PodMcpControl => ({
    token: async (request) => {
      const owner = await ownerFor(sessionId)
      if (owner === null) return undefined
      return await tokenOf({ owner, ...request })
    },
    begin: async (request) => {
      const owner = await ownerFor(sessionId)
      if (owner === null)
        return { ok: false, reason: 'this session has no owner to sign a server in for' }
      const begun = await args.gateway.begin({
        userId: owner.userId,
        projectId: owner.projectId,
        source: request.source,
        name: request.name,
        url: request.url,
        returnTarget: { surface: owner.surface, screen: { kind: 'session', id: sessionId } },
      })
      if (!begun.ok) return begun
      return { ok: true, url: begun.url }
    },
  })

  return { of: controlOf }
}

export const mcpControlPort = (): McpControlPort => {
  let port: McpControlPort | undefined
  return {
    of: (sessionId) => {
      if (port === undefined) {
        const env = readAgentHostEnv()
        const db = createDb(
          createPool(databaseUrlWithTls(env.databaseUrl), { queryTimeoutMs: QUERY_TIMEOUT_MS }),
        )
        const cipher = new SecretCipher(env.secretsEncryptionKey)
        port = mcpControlOf({
          db,
          cipher,
          gateway: mcpOauthGatewayOf({ db, cipher, publicUrl: env.publicUrl }),
        })
      }
      return port.of(sessionId)
    },
  }
}
