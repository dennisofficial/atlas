import { EMcpOauthReturnSurface, EMcpServerSource } from '@dltech/atlas-wire'
import { z } from 'zod'
import type { HostResolver } from './mcp-oauth-ssrf'

export enum EGrantRowStatus {
  Active = 'active',
  Expired = 'expired',
}

const clientInformationSchema = z.strictObject({
  clientId: z.string(),
  clientSecret: z.string().exactOptional(),
  clientIdIssuedAt: z.number().exactOptional(),
  clientSecretExpiresAt: z.number().exactOptional(),
})

const tokensSchema = z.strictObject({
  accessToken: z.string(),
  refreshToken: z.string().exactOptional(),
  expiresAt: z.string().exactOptional(),
  scope: z.string().exactOptional(),
})

export const sealedGrantSchema = z.strictObject({
  clientInfo: clientInformationSchema,
  tokens: tokensSchema,
  tokenEndpoint: z.string(),
  authMethods: z.array(z.string()).exactOptional(),
  resource: z.string().exactOptional(),
  redirectUri: z.string(),
})
export type SealedGrant = z.infer<typeof sealedGrantSchema>

export const sealedPendingSchema = z.strictObject({
  codeVerifier: z.string(),
  clientInfo: clientInformationSchema,
  tokenEndpoint: z.string(),
  authMethods: z.array(z.string()).exactOptional(),
  resource: z.string().exactOptional(),
  redirectUri: z.string(),
})
export type SealedPending = z.infer<typeof sealedPendingSchema>

export interface ServerGrantRow {
  id: string
  userId: string | null
  projectId: string | null
  name: string
  source: EMcpServerSource
  sealedSpec: string | null
  repoUrl: string | null
  lastSeenAt: Date | null
  oauthServerUrl: string | null
  oauthSealed: string | null
  oauthStatus: EGrantRowStatus | null
  oauthGeneration: number
  oauthRefreshAttempt: string | null
  oauthRefreshStartedAt: Date | null
  oauthUpdatedAt: Date | null
}

export interface PendingRow {
  id: string
  userId: string
  serverUrl: string
  sealed: string
  returnTo: string
  returnSurface: EMcpOauthReturnSurface
  expiresAt: Date
  mcpServerId: string | null
}

export interface AttemptFence {
  id: string
  attemptId: string
  generation: number
}

export abstract class McpOauthStore {
  abstract insertPending(row: PendingRow): Promise<void>
  abstract takePending(args: { id: string }): Promise<PendingRow | null>
  abstract findServer(args: { id: string }): Promise<ServerGrantRow | null>
  abstract listServers(args: {
    userId?: string | undefined
    projectId?: string | undefined
  }): Promise<ServerGrantRow[]>
  abstract findByName(args: {
    userId?: string | undefined
    projectId?: string | undefined
    source: EMcpServerSource
    name: string
  }): Promise<ServerGrantRow | null>
  abstract touchRepoServer(args: {
    userId?: string | undefined
    projectId?: string | undefined
    name: string
    url: string
    now: Date
  }): Promise<ServerGrantRow>
  abstract projectOwner(args: { projectId: string }): Promise<string | null>
  abstract writeGrant(args: { id: string; serverUrl: string; sealed: string }): Promise<void>
  abstract claim(args: {
    id: string
    generation: number
    attemptId: string
    startedAt: Date
  }): Promise<boolean>
  abstract complete(args: AttemptFence & { sealed: string }): Promise<boolean>
  abstract release(args: AttemptFence): Promise<boolean>
  abstract reject(args: AttemptFence): Promise<boolean>
  abstract clearGrant(args: { id: string }): Promise<void>
  abstract deleteRepoServer(args: { id: string }): Promise<void>
}

export abstract class McpOauthClock {
  abstract now(): number
}

export abstract class McpOauthFetcher {
  abstract fetch(input: string, init?: RequestInit): Promise<Response>
}

export abstract class McpOauthConfig {
  abstract readonly redirectUri: string
  abstract readonly webOrigin: string
  abstract readonly allowLocalTargets: boolean
  abstract readonly resolveHost?: HostResolver | undefined
}
