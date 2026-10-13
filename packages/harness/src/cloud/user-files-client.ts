import { CloudError, CloudTransport, type TransportRetryLog } from './cloud-transport'
import type { CloudSession } from './cloud-session'
import {
  userFileContentResponseSchema,
  userFileListResponseSchema,
  userFileRevisionResponseSchema,
  type UserFileMeta,
} from './cloud-resource-schemas'

export type { UserFileMeta } from './cloud-resource-schemas'

export type UserFileContent = UserFileMeta & { content: Uint8Array | null }

const CONFLICT_STATUS = 409

export class UserFileConflict extends Error {
  readonly currentRevision: number
  readonly contentHash: string

  constructor(args: { currentRevision: number; contentHash: string }) {
    super(`the file moved on the server (revision ${args.currentRevision})`)
    this.name = 'UserFileConflict'
    this.currentRevision = args.currentRevision
    this.contentHash = args.contentHash
  }
}

const filePath = (args: { tree: string; path: string }): string =>
  `/v1/user-files/${encodeURIComponent(args.tree)}/${args.path.split('/').map(encodeURIComponent).join('/')}`

export class CloudUserFilesClient {
  private readonly transport: CloudTransport

  constructor(args: {
    url: string
    token: string
    clientVersion?: string | undefined
    fetchFn?: typeof fetch | undefined
    log?: TransportRetryLog | undefined
  }) {
    this.transport = new CloudTransport(args)
  }

  async listUserFiles(args: { tree: string; sinceRevision?: number }): Promise<readonly UserFileMeta[]> {
    const since = args.sinceRevision === undefined ? '' : `&sinceRevision=${args.sinceRevision}`
    const body = await this.transport.request({
      method: 'GET',
      path: `/v1/user-files?tree=${encodeURIComponent(args.tree)}${since}`,
      retry: true,
    })
    return userFileListResponseSchema.parse(body).files
  }

  async getUserFiles(args: { tree: string; paths: readonly string[] }): Promise<readonly UserFileContent[]> {
    const body = await this.transport.request({
      method: 'POST',
      path: '/v1/user-files/get',
      body: { tree: args.tree, paths: args.paths },
      retry: true,
    })
    return userFileContentResponseSchema.parse(body).files.map((file) => ({
      ...file,
      content: file.content === null ? null : new Uint8Array(Buffer.from(file.content, 'base64')),
    }))
  }

  async putUserFile(args: {
    tree: string
    path: string
    content: Uint8Array
    contentHash: string
    baseRevision: number
  }): Promise<{ revision: number }> {
    return this.mutate({
      tree: args.tree,
      path: args.path,
      method: 'PUT',
      body: {
        content: Buffer.from(args.content).toString('base64'),
        contentHash: args.contentHash,
        baseRevision: args.baseRevision,
      },
    })
  }

  async deleteUserFile(args: { tree: string; path: string; baseRevision: number }): Promise<{ revision: number }> {
    return this.mutate({
      tree: args.tree,
      path: args.path,
      method: 'DELETE',
      body: { baseRevision: args.baseRevision },
    })
  }

  private async mutate(args: {
    tree: string
    path: string
    method: 'PUT' | 'DELETE'
    body: unknown
  }): Promise<{ revision: number }> {
    try {
      const body = await this.transport.request({
        method: args.method,
        path: filePath(args),
        body: args.body,
      })
      return userFileRevisionResponseSchema.parse(body)
    } catch (error) {
      if (!(error instanceof CloudError) || error.status !== CONFLICT_STATUS) throw error
      throw await this.conflictAt(args)
    }
  }

  private async conflictAt(args: { tree: string; path: string }): Promise<UserFileConflict> {
    const current = (await this.listUserFiles({ tree: args.tree })).find((file) => file.path === args.path)
    return new UserFileConflict({
      currentRevision: current?.revision ?? 0,
      contentHash: current?.contentHash ?? '',
    })
  }
}

export const cloudUserFilesClientFor = (args: {
  session: CloudSession
  clientVersion?: string | undefined
  fetchFn?: typeof fetch | undefined
  log?: TransportRetryLog | undefined
}): CloudUserFilesClient =>
  new CloudUserFilesClient({
    url: args.session.url,
    token: args.session.token,
    clientVersion: args.clientVersion,
    fetchFn: args.fetchFn,
    log: args.log,
  })
