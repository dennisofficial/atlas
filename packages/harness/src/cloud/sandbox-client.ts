import { z } from 'zod'

import { readRuntimeCheckpointReplySchema, type RuntimeCheckpoint } from '@dltech/atlas-wire'
import type { ApiClient } from '@dltech/atlas-api-router'

import { cloudCall, createHarnessApiClient } from './api-trpc-client'

export enum ECloudSandboxState {
  Running = 'running',
  Parked = 'parked',
  Resuming = 'resuming',
  Stopped = 'stopped',
  Unknown = 'unknown',
}

export const sandboxStateSchema = z.enum(ECloudSandboxState)

export const wireSandboxClaimSchema = z.object({
  token: z.string().min(1),
})

export type WireSandboxClaim = z.infer<typeof wireSandboxClaimSchema>

export const wireSandboxRegistrationSchema = z.object({
  token: z.string().min(1),
  url: z.string().optional(),
})

export type WireSandboxRegistration = z.infer<typeof wireSandboxRegistrationSchema>

export const clientTokenPattern = /^[0-9a-f]{64}$/

/** One row of the operator's sandbox listing: every sandbox the signed-in user has ever claimed. */
export const wireSandboxListEntrySchema = z.object({
  threadId: z.string(),
  name: z.string(),
  driveName: z.string().nullable().optional(),
  state: sandboxStateSchema,
  lastActivityAt: z.string(),
})

export type WireSandboxListEntry = z.infer<typeof wireSandboxListEntrySchema>

export const workspaceSpecSchema = z.object({
  remoteUrl: z.string().nullable(),
})

export type WorkspaceSpec = z.infer<typeof workspaceSpecSchema>

/**
 * The rendezvous half of the sandbox contract: the row, the session token it mints, the context
 * archive, and the workspace spec the sandbox curls. Vercel itself is never touched here — the
 * operator's own token drives that through `VercelDriver`.
 */
export class SandboxClient {
  private readonly api: ApiClient

  constructor(args: {
    url: string
    token: string
    clientVersion?: string | undefined
    fetchFn?: typeof fetch | undefined
  }) {
    this.api = createHarnessApiClient({
      url: args.url,
      token: args.token,
      clientVersion: args.clientVersion ?? 'dev',
      fetchFn: args.fetchFn ?? fetch,
    })
  }

  /**
   * Upserts the row and mints (or reissues) the sandbox session token. No provisioning happens
   * server-side, so a reattach is the same call with a fresh git token and `contextPending`
   * naming whether the client believes the sandbox will boot fresh (needing the context archive)
   * or resume from its snapshot.
   */
  async claimSandbox(args: {
    threadId: string
    gitToken: string
    contextPending: boolean
    workspace?: WorkspaceSpec | undefined
  }): Promise<WireSandboxClaim> {
    const body = await cloudCall(
      this.api.sandboxes.claim.mutate({
        threadId: args.threadId,
        gitToken: args.gitToken,
        contextPending: args.contextPending,
        ...(args.workspace === undefined ? {} : { workspace: args.workspace }),
      }),
    )
    return wireSandboxClaimSchema.parse(body)
  }

  async registerSandbox(args: {
    threadId: string
    token: string
    serveUrl: string
    serveVersion?: string | undefined
    metadata?: { title?: string; repo?: string; model?: string } | undefined
  }): Promise<WireSandboxRegistration> {
    const body = await cloudCall(
      this.api.sandboxes.claim.mutate({
        threadId: args.threadId,
        clientToken: args.token,
        serveUrl: args.serveUrl,
        ...(args.serveVersion === undefined ? {} : { serveVersion: args.serveVersion }),
        ...(args.metadata === undefined ? {} : { metadata: args.metadata }),
      }),
    )
    return wireSandboxRegistrationSchema.parse(body)
  }

  /** Operator-session auth: the signed-in user's own sandbox rows, newest activity first. */
  async listSandboxes(): Promise<WireSandboxListEntry[]> {
    const body = await cloudCall(this.api.sandboxes.list.query())
    return z.array(wireSandboxListEntrySchema).parse(body)
  }

  /** A sandbox already gone is the caller's desired end state, so a 404 here is success, not an error. */
  async destroySandbox(args: { threadId: string }): Promise<void> {
    await cloudCall(this.api.sandboxes.destroy.mutate({ threadId: args.threadId }), {
      allowMissing: true,
    })
  }

  async readCheckpoint(args: { threadId: string }): Promise<RuntimeCheckpoint | null> {
    const body = await cloudCall(
      this.api.sandboxCheckpoint.get.query({ threadId: args.threadId }),
      { allowMissing: true },
    )
    if (body === undefined || body === null) return null
    const parsed = readRuntimeCheckpointReplySchema.safeParse(body)
    return parsed.success ? parsed.data.checkpoint : null
  }
}
