import type { ApiClient } from '@dltech/atlas-api-router'
import { userFileTreeSchema, type UserFileMeta, type EUserFileTree } from '@dltech/atlas-wire'

import { cloudCall, createHarnessApiClient } from './api-trpc-client'
import {
  backoffDelayMs,
  defaultSleep,
  isRetryableStatus,
  noteRetry,
  type TransportRetryLog,
} from './cloud-retry'
import {
  CloudError,
  DEFAULT_RETRY_BASE_DELAY_MS,
  DEFAULT_RETRY_CEILING_DELAY_MS,
  DEFAULT_RETRY_MAX_ATTEMPTS,
} from './cloud-transport'
import type { CloudSession } from './cloud-session'

export type { UserFileMeta } from '@dltech/atlas-wire'

export type UserFileContent = UserFileMeta & { content: Uint8Array | null }

const CONFLICT_STATUS = 409
const NETWORK_FAILURE_STATUS = 0

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

const isRetryable = (error: unknown): boolean =>
  error instanceof CloudError &&
  (error.status === NETWORK_FAILURE_STATUS || isRetryableStatus(error.status))

const treeOf = (tree: string): EUserFileTree => userFileTreeSchema.parse(tree)

export class CloudUserFilesClient {
  private readonly api: ApiClient
  private readonly log: TransportRetryLog | undefined
  private readonly sleep: (ms: number) => Promise<void>
  private readonly randomFn: () => number

  constructor(args: {
    url: string
    token: string
    clientVersion?: string | undefined
    fetchFn?: typeof fetch | undefined
    log?: TransportRetryLog | undefined
    sleep?: ((ms: number) => Promise<void>) | undefined
    randomFn?: (() => number) | undefined
  }) {
    this.log = args.log
    this.sleep = args.sleep ?? defaultSleep
    this.randomFn = args.randomFn ?? Math.random
    this.api = createHarnessApiClient({
      url: args.url,
      token: args.token,
      clientVersion: args.clientVersion ?? 'dev',
      fetchFn: args.fetchFn ?? fetch,
      log: args.log,
      sleep: args.sleep,
      randomFn: args.randomFn,
    })
  }

  async listUserFiles(args: {
    tree: string
    sinceRevision?: number
  }): Promise<readonly UserFileMeta[]> {
    const reply = await cloudCall(
      this.api.userFiles.list.query({
        tree: treeOf(args.tree),
        ...(args.sinceRevision === undefined ? {} : { sinceRevision: args.sinceRevision }),
      }),
    )
    return reply.files
  }

  async getUserFiles(args: {
    tree: string
    paths: readonly string[]
  }): Promise<readonly UserFileContent[]> {
    const tree = treeOf(args.tree)
    const reply = await this.retried(() =>
      cloudCall(this.api.userFiles.get.mutate({ tree, paths: [...args.paths] })),
    )
    return reply.files.map((file) => ({
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
    return this.mutate(args, () =>
      cloudCall(
        this.api.userFiles.put.mutate({
          tree: treeOf(args.tree),
          path: args.path,
          content: Buffer.from(args.content).toString('base64'),
          contentHash: args.contentHash,
          baseRevision: args.baseRevision,
        }),
      ),
    )
  }

  async deleteUserFile(args: {
    tree: string
    path: string
    baseRevision: number
  }): Promise<{ revision: number }> {
    return this.mutate(args, () =>
      cloudCall(
        this.api.userFiles.remove.mutate({
          tree: treeOf(args.tree),
          path: args.path,
          baseRevision: args.baseRevision,
        }),
      ),
    )
  }

  private async retried<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await call()
      } catch (error) {
        const cause = error instanceof CloudError ? `status ${error.status}` : String(error)
        if (!isRetryable(error) || attempt >= DEFAULT_RETRY_MAX_ATTEMPTS - 1) throw error
        const delayMs = backoffDelayMs({
          attempt,
          baseDelayMs: DEFAULT_RETRY_BASE_DELAY_MS,
          ceilingDelayMs: DEFAULT_RETRY_CEILING_DELAY_MS,
          randomFn: this.randomFn,
        })
        noteRetry({
          log: this.log,
          method: 'POST',
          path: 'userFiles.get',
          cause,
          attempt,
          delayMs,
        })
        await this.sleep(delayMs)
      }
    }
  }

  private async mutate(
    args: { tree: string; path: string },
    call: () => Promise<{ revision: number }>,
  ): Promise<{ revision: number }> {
    try {
      return await call()
    } catch (error) {
      if (!(error instanceof CloudError) || error.status !== CONFLICT_STATUS) throw error
      throw await this.conflictAt(args)
    }
  }

  private async conflictAt(args: { tree: string; path: string }): Promise<UserFileConflict> {
    const current = (await this.listUserFiles({ tree: args.tree })).find(
      (file) => file.path === args.path,
    )
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
