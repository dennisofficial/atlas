import {
  EMemoryScope,
  memoryEntrySchema,
  memoryListSchema,
  memorySummarySchema,
  type EMemoryType,
  type MemoryEntry,
  type MemorySummary,
} from '@dltech/atlas-wire'

import type { CloudSession } from '../cloud/cloud-session'
import { CloudError, CloudTransport } from '../cloud/cloud-transport'

import { MemoryEditRefused, MemoryPort, MemoryUnavailable, type MemoryAddress } from './memory-port'

const MEMORIES_PATH = '/v1/memories'
const ENTRY_PATH = `${MEMORIES_PATH}/entry`

const NO_PROJECT = 'this session has no GitHub repository, so only global memory is available'
const SIGNED_OUT = 'sign in to Atlas Cloud to use memory'

const malformed = (path: string): CloudError =>
  new CloudError({
    status: 502,
    message: `The Atlas Cloud API answered ${path} with a body that is not a memory.`,
  })

const isEditRefusal = (error: unknown): error is CloudError =>
  error instanceof CloudError && [404, 409, 422].includes(error.status)

export class CloudMemoryPort extends MemoryPort {
  readonly project: string | null
  private readonly session: () => CloudSession | null
  private readonly clientVersion: string
  private readonly fetchFn: typeof fetch | undefined

  constructor(args: {
    project: string | null
    session: () => CloudSession | null
    clientVersion: string
    fetchFn?: typeof fetch | undefined
  }) {
    super()
    this.project = args.project
    this.session = args.session
    this.clientVersion = args.clientVersion
    this.fetchFn = args.fetchFn
  }

  async list(args?: { timeoutMs?: number | undefined }): Promise<readonly MemorySummary[]> {
    const query = this.project === null ? '' : `?${new URLSearchParams({ project: this.project })}`
    const path = `${MEMORIES_PATH}${query}`
    const timeoutMs = args?.timeoutMs
    const body = await this.transport().request({
      method: 'GET',
      path,
      retry: timeoutMs === undefined,
      timeoutMs,
    })
    const parsed = memoryListSchema.safeParse(body)
    if (!parsed.success) throw malformed(path)
    return parsed.data.memories
  }

  async read(args: MemoryAddress): Promise<MemoryEntry | null> {
    const path = `${ENTRY_PATH}?${this.addressQuery(args)}`
    const body = await this.transport().request({
      method: 'GET',
      path,
      retry: true,
      allowMissing: true,
    })
    if (body === undefined) return null
    const parsed = memoryEntrySchema.safeParse(body)
    if (!parsed.success) throw malformed(path)
    return parsed.data
  }

  async write(
    args: MemoryAddress & { description: string; type: EMemoryType; body: string },
  ): Promise<MemorySummary> {
    const body = await this.transport().request({
      method: 'PUT',
      path: ENTRY_PATH,
      body: { ...this.addressBody(args), description: args.description, type: args.type, body: args.body },
      retry: false,
    })
    return this.parseSummary(body)
  }

  async edit(
    args: MemoryAddress & { old: string; new: string; revision: number },
  ): Promise<MemorySummary> {
    const transport = this.transport()
    try {
      const body = await transport.request({
        method: 'PATCH',
        path: ENTRY_PATH,
        body: { ...this.addressBody(args), old: args.old, new: args.new, revision: args.revision },
        retry: false,
      })
      return this.parseSummary(body)
    } catch (error) {
      if (!isEditRefusal(error)) throw error
      throw new MemoryEditRefused({ code: error.code, message: error.message })
    }
  }

  async delete(args: MemoryAddress): Promise<boolean> {
    const path = `${ENTRY_PATH}?${this.addressQuery(args)}`
    try {
      await this.transport().request({ method: 'DELETE', path, retry: false })
      return true
    } catch (error) {
      if (error instanceof CloudError && error.status === 404) return false
      throw error
    }
  }

  private transport(): CloudTransport {
    const session = this.session()
    if (session === null) throw new MemoryUnavailable(SIGNED_OUT)
    return new CloudTransport({
      url: session.url,
      token: session.token,
      clientVersion: this.clientVersion,
      fetchFn: this.fetchFn,
    })
  }

  private projectFor(scope: EMemoryScope): string | undefined {
    if (scope === EMemoryScope.Global) return undefined
    if (this.project === null) throw new MemoryUnavailable(NO_PROJECT)
    return this.project
  }

  private addressQuery(args: MemoryAddress): string {
    const project = this.projectFor(args.scope)
    return new URLSearchParams({
      scope: args.scope,
      name: args.name,
      ...(project === undefined ? {} : { project }),
    }).toString()
  }

  private addressBody(args: MemoryAddress): { scope: EMemoryScope; name: string; project?: string } {
    const project = this.projectFor(args.scope)
    return { scope: args.scope, name: args.name, ...(project === undefined ? {} : { project }) }
  }

  private parseSummary(body: unknown): MemorySummary {
    const parsed = memorySummarySchema.safeParse(body)
    if (!parsed.success) throw malformed(ENTRY_PATH)
    return parsed.data
  }
}
