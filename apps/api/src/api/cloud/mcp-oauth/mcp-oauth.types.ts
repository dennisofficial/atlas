import { EMcpServerSource } from '@dltech/atlas-wire'
import type { HostResolver } from '../../../agent'

export enum EGrantRowStatus {
  Active = 'active',
  Expired = 'expired',
}

export interface ServerGrantRow {
  id: string
  userId: string | null
  projectId: string | null
  groupId: string | null
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

export interface AttemptFence {
  id: string
  attemptId: string
  generation: number
}

export abstract class McpOauthStore {
  abstract findServer(args: { id: string }): Promise<ServerGrantRow | null>
  abstract listServers(args: {
    userId?: string | undefined
    groupId?: string | undefined
    projectId?: string | undefined
  }): Promise<ServerGrantRow[]>
  abstract findByName(args: {
    userId?: string | undefined
    groupId?: string | undefined
    projectId?: string | undefined
    source: EMcpServerSource
    name: string
  }): Promise<ServerGrantRow | null>
  abstract touchRepoServer(args: {
    userId?: string | undefined
    groupId?: string | undefined
    projectId?: string | undefined
    name: string
    url: string
    now: Date
  }): Promise<ServerGrantRow>
  abstract projectOwner(args: { projectId: string }): Promise<string | null>
  abstract groupOwner(args: { groupId: string }): Promise<string | null>
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
  abstract readonly allowLocalTargets: boolean
  abstract readonly resolveHost?: HostResolver | undefined
}
