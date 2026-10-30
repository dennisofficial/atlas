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

export interface GrantRow {
  id: string
  userId: string
  serverUrl: string
  status: EGrantRowStatus
  sealed: string
  generation: number
  refreshAttempt: string | null
  refreshStartedAt: Date | null
  updatedAt: Date
}

export interface PendingRow {
  id: string
  userId: string
  serverUrl: string
  sealed: string
  returnTo: string
  expiresAt: Date
}

export interface AttemptFence {
  id: string
  attemptId: string
  generation: number
}

export abstract class McpOauthStore {
  abstract insertPending(row: PendingRow): Promise<void>
  abstract takePending(args: { id: string }): Promise<PendingRow | null>
  abstract findGrant(args: { userId: string; serverUrl: string }): Promise<GrantRow | null>
  abstract findGrants(args: { userId: string; serverUrls: string[] }): Promise<GrantRow[]>
  abstract upsertGrant(args: { userId: string; serverUrl: string; sealed: string }): Promise<void>
  abstract claim(args: {
    id: string
    generation: number
    attemptId: string
    startedAt: Date
    staleBefore: Date
  }): Promise<boolean>
  abstract complete(args: AttemptFence & { sealed: string }): Promise<boolean>
  abstract release(args: AttemptFence): Promise<boolean>
  abstract reject(args: AttemptFence): Promise<boolean>
  abstract deleteGrant(args: { userId: string; serverUrl: string }): Promise<void>
}

export abstract class McpOauthClock {
  abstract now(): number
  abstract sleep(ms: number): Promise<void>
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
