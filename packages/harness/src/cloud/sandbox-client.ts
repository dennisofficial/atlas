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

export const wireSandboxSchema = z.object({
  url: z.string().min(1).optional(),
  token: z.string().min(1),
  state: sandboxStateSchema,
})

export type WireSandbox = z.infer<typeof wireSandboxSchema>

export const wireSandboxStatusSchema = z.object({
  state: sandboxStateSchema,
  url: z.string().min(1).optional(),
})

export type WireSandboxStatus = z.infer<typeof wireSandboxStatusSchema>

export const wireSandboxExposureSchema = z.object({
  url: z.string().min(1),
})

export const workspaceSpecSchema = z.object({
  remoteUrl: z.string().nullable(),
  branch: z.string().nullable(),
  commit: z.string().nullable(),
  patch: z.string(),
  projectDirectory: z.string().nullish(),
})

export type WorkspaceSpec = z.infer<typeof workspaceSpecSchema>

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

  async createSandbox(args: {
    threadId: string
    workspace?: WorkspaceSpec | undefined
  }): Promise<WireSandbox> {
    const body = await this.request({
      method: 'POST',
      path: '/v1/sandboxes',
      body: {
        threadId: args.threadId,
        ...(args.workspace === undefined ? {} : { workspace: args.workspace }),
      },
    })
    return wireSandboxSchema.parse(body)
  }

  /**
   * Operator-session auth, the same guard as `createSandbox` — the sandbox row the archive lands
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

  async stopSandbox(args: { threadId: string }): Promise<void> {
    await this.request({ method: 'POST', path: `/v1/sandboxes/${args.threadId}/stop` })
  }

  async exposePort(args: { threadId: string; port: number }): Promise<string> {
    const body = await this.request({
      method: 'POST',
      path: `/v1/sandboxes/${args.threadId}/expose`,
      body: { port: args.port },
    })
    return wireSandboxExposureSchema.parse(body).url
  }

  async findSandbox(args: { threadId: string }): Promise<WireSandboxStatus | undefined> {
    const body = await this.request({
      method: 'GET',
      path: `/v1/sandboxes/${args.threadId}`,
      allowMissing: true,
    })
    if (body === undefined || body === null) return undefined
    return wireSandboxStatusSchema.parse(body)
  }

  private request(args: {
    method: string
    path: string
    body?: unknown
    allowMissing?: boolean
  }): Promise<unknown> {
    return this.transport.request(args)
  }
}
