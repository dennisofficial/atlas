import { z } from 'zod'

import { CloudTransport } from './cloud-transport'

export enum ECloudSandboxState {
  Running = 'running',
  Parked = 'parked',
  Resuming = 'resuming',
}

export const sandboxStateSchema = z.nativeEnum(ECloudSandboxState)

/**
 * Shared with `apps/api/src/api/context-archive/context-archive-limits.ts`, which duplicates this
 * value rather than importing it — `apps/api` carries no in-repo dependency by design (see its
 * AGENTS.md). The API buffers the whole request body before a handler ever sees it (`express.raw`
 * concatenates it, Prisma returns the whole bytea column), so this is a deliberate per-request
 * memory budget sized against the API container rather than a streaming limit. The #485 OOM was a
 * 109MB `writeFiles` push through an SDK that multiplied the buffer several times over; a single
 * buffered body at this cap is the accepted bound.
 */
export const MAX_CONTEXT_ARCHIVE_BYTES = 256 * 1024 * 1024

/**
 * What the claim route answers: the fresh sandbox session token, and nothing else. Every Vercel
 * fact — url, state, whether the sandbox is new — comes from the driver's own SDK calls, not from
 * the control plane.
 */
export const wireSandboxClaimSchema = z.object({
  token: z.string().min(1),
})

export type WireSandboxClaim = z.infer<typeof wireSandboxClaimSchema>

/** One row of the operator's sandbox listing: every sandbox the signed-in user has ever claimed. */
export const wireSandboxListEntrySchema = z.object({
  threadId: z.string(),
  name: z.string(),
  driveName: z.string().nullable(),
  state: sandboxStateSchema,
  lastActivityAt: z.string(),
})

export type WireSandboxListEntry = z.infer<typeof wireSandboxListEntrySchema>

export const workspaceSpecSchema = z.object({
  remoteUrl: z.string().nullable(),
  branch: z.string().nullable(),
  commit: z.string().nullable(),
  patch: z.string(),
  projectDirectory: z.string().nullish(),
  gitIdentity: z.object({ name: z.string(), email: z.string() }).nullable().nullish(),
})

export type WorkspaceSpec = z.infer<typeof workspaceSpecSchema>

/**
 * The rendezvous half of the sandbox contract: the row, the session token it mints, the context
 * archive, and the workspace spec the sandbox curls. Vercel itself is never touched here — the
 * operator's own token drives that through `VercelDriver`.
 */
export class SandboxClient {
  private readonly transport: CloudTransport

  constructor(args: {
    url: string
    token: string
    clientVersion?: string | undefined
    fetchFn?: typeof fetch | undefined
  }) {
    this.transport = new CloudTransport(args)
  }

  /**
   * Upserts the row and mints (or reissues) the sandbox session token. No provisioning happens
   * server-side, so a reattach is the same POST with a fresh git token and `contextPending`
   * naming whether the client believes the sandbox will boot fresh (needing the context archive)
   * or resume from its snapshot.
   */
  async claimSandbox(args: {
    threadId: string
    gitToken: string
    contextPending: boolean
    workspace?: WorkspaceSpec | undefined
    gpgKey?: string | undefined
    driveName?: string | undefined
  }): Promise<WireSandboxClaim> {
    const body = await this.request({
      method: 'POST',
      path: '/v1/sandboxes',
      body: {
        threadId: args.threadId,
        gitToken: args.gitToken,
        contextPending: args.contextPending,
        ...(args.workspace === undefined ? {} : { workspace: args.workspace }),
        ...(args.gpgKey === undefined ? {} : { gpgKey: args.gpgKey }),
        ...(args.driveName === undefined ? {} : { driveName: args.driveName }),
      },
    })
    return wireSandboxClaimSchema.parse(body)
  }

  /** Operator-session auth: the signed-in user's own sandbox rows, newest activity first. */
  async listSandboxes(): Promise<WireSandboxListEntry[]> {
    const body = await this.request({ method: 'GET', path: '/v1/sandboxes', retry: true })
    return z.array(wireSandboxListEntrySchema).parse(body)
  }

  /**
   * Operator-session auth, the same guard as `claimSandbox` — the sandbox row the archive lands
   * on already exists by the time this runs, but the sandbox's own token does not need to.
   */
  async putContextArchive(args: { threadId: string; archive: Uint8Array }): Promise<void> {
    await this.transport.rawRequest({
      method: 'PUT',
      path: `/v1/sandboxes/${args.threadId}/context`,
      body: args.archive,
      contentType: 'application/gzip',
    })
  }

  /** The lifted session's transcript tar, uploaded with the same auth as the context archive. */
  async putTranscriptArchive(args: { threadId: string; archive: Uint8Array }): Promise<void> {
    await this.transport.rawRequest({
      method: 'PUT',
      path: `/v1/sandboxes/${args.threadId}/transcript`,
      body: args.archive,
      contentType: 'application/gzip',
    })
  }

  /** A sandbox already gone is the caller's desired end state, so a 404 here is success, not an error. */
  async destroySandbox(args: { threadId: string }): Promise<void> {
    await this.request({
      method: 'POST',
      path: `/v1/sandboxes/${args.threadId}/destroy`,
      allowMissing: true,
    })
  }

  private request(args: {
    method: string
    path: string
    body?: unknown
    allowMissing?: boolean
    retry?: boolean
  }): Promise<unknown> {
    return this.transport.request(args)
  }
}
