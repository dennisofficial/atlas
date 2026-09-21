import { z } from 'zod'

import { cloudRequest } from './cloud-transport'

export enum ECloudSandboxState {
  Running = 'running',
  Parked = 'parked',
  Resuming = 'resuming',
}

export const sandboxStateSchema = z.nativeEnum(ECloudSandboxState)

/**
 * Shared with `apps/api/src/api/sandboxes/workspace-spec.ts`, which duplicates this value rather
 * than importing it — `apps/api` carries no in-repo dependency by design (see its AGENTS.md).
 */
export const MAX_CONTEXT_BUNDLE_BYTES = 64 * 1024 * 1024

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
  private readonly url: string
  private readonly token: string
  private readonly clientVersion: string
  private readonly fetchFn: typeof fetch

  constructor(args: {
    url: string
    token: string
    clientVersion?: string | undefined
    fetchFn?: typeof fetch | undefined
  }) {
    this.url = args.url.replace(/\/+$/, '')
    this.token = args.token
    this.clientVersion = args.clientVersion ?? 'dev'
    this.fetchFn = args.fetchFn ?? fetch
  }

  async createSandbox(args: {
    threadId: string
    workspace?: WorkspaceSpec | undefined
    contextBundle?: string | undefined
  }): Promise<WireSandbox> {
    const body = await this.request({
      method: 'POST',
      path: '/v1/sandboxes',
      body: {
        threadId: args.threadId,
        ...(args.workspace === undefined ? {} : { workspace: args.workspace }),
        ...(args.contextBundle === undefined ? {} : { contextBundle: args.contextBundle }),
      },
    })
    return wireSandboxSchema.parse(body)
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
    return cloudRequest({
      url: this.url,
      token: this.token,
      clientVersion: this.clientVersion,
      fetchFn: this.fetchFn,
      method: args.method,
      path: args.path,
      ...(args.body === undefined ? {} : { body: args.body }),
      ...(args.allowMissing === undefined ? {} : { allowMissing: args.allowMissing }),
    })
  }
}
