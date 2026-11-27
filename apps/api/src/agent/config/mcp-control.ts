import { createDb, createPool, type Db } from '@dltech/atlas-db'
import {
  EMcpToken,
  MacOfflineError,
  type McpServerSource,
  type McpToken,
  type PodMcpControl,
  type PodMcpProxyTransport,
} from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import {
  MacOfflineError as MacLinkOfflineError,
  type MacChannel,
  type MacLink,
} from '../mac-link/port'
import { browserReturnsOf } from '../browser-return/from-env'
import { mcpOauthGatewayOf, type McpOauthGateway } from '../mcp-oauth'
import { sameServerUrl } from '../mcp-oauth/seal'
import { serverUrlOf, type ServerUrlRow } from '../mcp-oauth/server-url'
import { databaseUrlWithTls } from './database-url'
import type { AgentHostEnv } from './env'
import { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'

const QUERY_TIMEOUT_MS = 10_000

const OWNER_CACHE_LIMIT = 500

const grantSchema = z.object({
  tokens: z.object({ accessToken: z.string(), expiresAt: z.string().optional() }),
})

type Owner = {
  userId: string
  projectId: string | null
  groupId: string | null
}

type ServerRow = {
  name: string
  source: string
  repoUrl: string | null
  sealedSpec: string | null
  oauthStatus: string | null
  oauthSealed: string | null
  oauthServerUrl: string | null
  oauthRefusal: string | null
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

const serverUrlIn = (args: { cipher: SecretCipher; row: ServerUrlRow }): string | undefined => {
  try {
    return serverUrlOf(args)
  } catch {
    return undefined
  }
}

export const offlineMacLink: MacLink = {
  online: async () => false,
  open: async () => {
    throw new MacLinkOfflineError(0)
  },
}

export const mcpControlOf = (args: {
  db: Db
  cipher: SecretCipher
  gateway: McpOauthGateway
  macLink: MacLink
}): McpControlPort => {
  const owners = new Map<string, Promise<Owner | null>>()

  const groupIdOf = async (projectId: string | null): Promise<string | null> => {
    if (projectId === null) return null
    const project = await args.db.orm.public.Project.first({ id: projectId })
    return project?.groupId ?? null
  }

  const ownerFor = async (sessionId: string): Promise<Owner | null> => {
    const cached = owners.get(sessionId)
    if (cached !== undefined) return await cached
    const read = args.db.orm.public.Session.first({ id: sessionId }).then(async (session) =>
      session === null || session === undefined
        ? null
        : {
            userId: session.userId,
            projectId: session.projectId,
            groupId: await groupIdOf(session.projectId),
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
    const user = await servers
      .where({ userId: args2.owner.userId, source: args2.source, name: args2.name })
      .all()
    if (args2.owner.projectId === null) return user
    const [group, project] = await Promise.all([
      args2.owner.groupId === null
        ? Promise.resolve([])
        : servers
            .where({ groupId: args2.owner.groupId, source: args2.source, name: args2.name })
            .all(),
      servers
        .where({ projectId: args2.owner.projectId, source: args2.source, name: args2.name })
        .all(),
    ])
    return [...user, ...group, ...project]
  }

  const refusalAtUrl = (args2: { rows: readonly ServerRow[]; url: string }): string | null => {
    const direct = args2.rows.find(
      (candidate) =>
        sameServerUrl(candidate.repoUrl, args2.url) ||
        sameServerUrl(candidate.oauthServerUrl, args2.url),
    )
    const matched =
      direct ??
      args2.rows.find((candidate) =>
        sameServerUrl(serverUrlIn({ cipher: args.cipher, row: candidate }), args2.url),
      )
    return matched?.oauthRefusal ?? null
  }

  const tokenOf = async (args2: {
    owner: Owner
    name: string
    source: McpServerSource
    url: string
  }): Promise<McpToken> => {
    const rows = await rowsFor(args2)
    const row = rows.find(
      (candidate) =>
        sameServerUrl(candidate.repoUrl, args2.url) ||
        sameServerUrl(candidate.oauthServerUrl, args2.url),
    )
    if (row === undefined || row.oauthStatus !== 'active' || row.oauthSealed === null) {
      const refusal = refusalAtUrl({ rows, url: args2.url })
      return refusal === null
        ? { kind: EMcpToken.SignIn }
        : { kind: EMcpToken.Refused, reason: refusal }
    }
    const fresh = freshTokenOf({ cipher: args.cipher, sealed: row.oauthSealed })
    if (fresh !== undefined) return { kind: EMcpToken.Granted, accessToken: fresh }
    const refreshed = await args.gateway.refresh({
      userId: args2.owner.userId,
      ...(args2.owner.projectId === null ? {} : { projectId: args2.owner.projectId }),
      ...(args2.owner.groupId === null ? {} : { groupId: args2.owner.groupId }),
      source: args2.source,
      name: args2.name,
      url: args2.url,
    })
    if (refreshed.ok) return { kind: EMcpToken.Granted, accessToken: refreshed.accessToken }
    return refreshed.signIn === true
      ? { kind: EMcpToken.SignIn }
      : { kind: EMcpToken.Unavailable, reason: refreshed.reason }
  }

  const controlOf = (sessionId: string): PodMcpControl => ({
    token: async (request) => {
      try {
        const owner = await ownerFor(sessionId)
        if (owner === null) return { kind: EMcpToken.SignIn }
        return await tokenOf({ owner, ...request })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        return { kind: EMcpToken.Unavailable, reason }
      }
    },
    begin: async (request) => {
      const owner = await ownerFor(sessionId)
      if (owner === null)
        return { ok: false, reason: 'this session has no owner to sign a server in for' }
      const begun = await args.gateway.begin({
        userId: owner.userId,
        ...(owner.projectId === null ? {} : { projectId: owner.projectId }),
        ...(owner.groupId === null ? {} : { groupId: owner.groupId }),
        source: request.source,
        name: request.name,
        url: request.url,
        returnTarget: { surface: 'web', screen: { kind: 'session', id: sessionId } },
      })
      if (!begun.ok) return begun
      return { ok: true, url: begun.startUrl, expiresAt: begun.expiresAt }
    },
    proxy: async (request) => {
      const owner = await ownerFor(sessionId)
      if (owner === null) throw new MacOfflineError()
      if (!(await args.macLink.online(owner.userId))) throw new MacOfflineError()
      const channel = await openMacLink({
        userId: owner.userId,
        name: request.name,
        transport: request.transport,
        waitMs: request.waitMs,
      })
      return {
        send: (message) => channel.send(message),
        onMessage: (listener) => channel.onMessage(listener),
        onClosed: (listener) => channel.onClosed(listener),
        close: () => channel.close(),
      }
    },
  })

  const openMacLink = async (request: {
    userId: string
    name: string
    transport: PodMcpProxyTransport
    waitMs: number
  }): Promise<MacChannel> => {
    try {
      return await args.macLink.open({
        userId: request.userId,
        server: { name: request.name, transport: request.transport },
        waitMs: request.waitMs,
      })
    } catch (error) {
      if (error instanceof MacLinkOfflineError) throw new MacOfflineError()
      throw error
    }
  }

  return { of: controlOf }
}

export const mcpControlPort = (args: {
  env: Pick<AgentHostEnv, 'databaseUrl' | 'secretsEncryptionKey' | 'publicUrl' | 'trustedOrigins'>
  macLink: MacLink
}): McpControlPort => {
  let port: McpControlPort | undefined
  return {
    of: (sessionId) => {
      if (port === undefined) {
        const db = createDb(
          createPool(databaseUrlWithTls(args.env.databaseUrl), {
            queryTimeoutMs: QUERY_TIMEOUT_MS,
          }),
        )
        const cipher = new SecretCipher(args.env.secretsEncryptionKey)
        port = mcpControlOf({
          db,
          cipher,
          gateway: mcpOauthGatewayOf({
            db,
            cipher,
            publicUrl: args.env.publicUrl,
            returns: browserReturnsOf({ db, cipher, env: args.env }),
          }),
          macLink: args.macLink,
        })
      }
      return port.of(sessionId)
    },
  }
}
