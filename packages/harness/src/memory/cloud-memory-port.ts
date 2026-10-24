import {
  EMemoryScope,
  memoryEntrySchema,
  memoryListSchema,
  memorySummarySchema,
  type EMemoryType,
  type MemoryEntry,
  type MemorySummary,
} from '@dltech/atlas-wire'

import { createApiClient, type ApiClient } from '@dltech/atlas-api-router'

import { cloudCall, createHarnessApiClient } from '../cloud/api-trpc-client'
import type { CloudSession } from '../cloud/cloud-session'
import { CloudError } from '../cloud/cloud-transport'

import { MemoryEditRefused, MemoryPort, MemoryUnavailable, type MemoryAddress } from './memory-port'

const NO_PROJECT = 'this session has no GitHub repository, so only global memory is available'
const SIGNED_OUT = 'sign in to Atlas Cloud to use memory'

const malformed = (procedure: string): CloudError =>
  new CloudError({
    status: 502,
    message: `The Atlas Cloud API answered ${procedure} with a body that is not a memory.`,
  })

const isEditRefusal = (error: unknown): error is CloudError =>
  error instanceof CloudError && [404, 409, 422].includes(error.status)

const singleAttempt = (args: { fetchFn: typeof fetch; timeoutMs: number }): typeof fetch =>
  Object.assign(
    (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      args.fetchFn(input, { ...init, signal: AbortSignal.timeout(args.timeoutMs) }),
    { preconnect: fetch.preconnect },
  )

type Address = { scope: EMemoryScope; name: string; project?: string }

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
    const client = this.client({ timeoutMs: args?.timeoutMs })
    const body = await cloudCall(
      client.memories.list.query(this.project === null ? {} : { project: this.project }),
    )
    const parsed = memoryListSchema.safeParse(body)
    if (!parsed.success) throw malformed('memories.list')
    return parsed.data.memories
  }

  async read(args: MemoryAddress): Promise<MemoryEntry | null> {
    const body = await cloudCall(this.client().memories.get.query(this.address(args)), {
      allowMissing: true,
    })
    if (body === undefined) return null
    const parsed = memoryEntrySchema.safeParse(body)
    if (!parsed.success) throw malformed('memories.get')
    return parsed.data
  }

  async write(
    args: MemoryAddress & { description: string; type: EMemoryType; body: string },
  ): Promise<MemorySummary> {
    const client = this.client()
    const body = await cloudCall(
      client.memories.put.mutate({
        ...this.address(args),
        description: args.description,
        type: args.type,
        body: args.body,
      }),
    )
    return this.parseSummary({ body, procedure: 'memories.put' })
  }

  async edit(
    args: MemoryAddress & { old: string; new: string; revision: number },
  ): Promise<MemorySummary> {
    const client = this.client()
    try {
      const body = await cloudCall(
        client.memories.edit.mutate({
          ...this.address(args),
          old: args.old,
          new: args.new,
          revision: args.revision,
        }),
      )
      return this.parseSummary({ body, procedure: 'memories.edit' })
    } catch (error) {
      if (!isEditRefusal(error)) throw error
      throw new MemoryEditRefused({ code: error.code, message: error.message })
    }
  }

  async delete(args: MemoryAddress): Promise<boolean> {
    const client = this.client()
    try {
      await cloudCall(client.memories.remove.mutate(this.address(args)))
      return true
    } catch (error) {
      if (error instanceof CloudError && error.status === 404) return false
      throw error
    }
  }

  private client(args?: { timeoutMs?: number | undefined }): ApiClient {
    const session = this.session()
    if (session === null) throw new MemoryUnavailable(SIGNED_OUT)
    const fetchFn = this.fetchFn ?? fetch
    if (args?.timeoutMs !== undefined) {
      return createApiClient({
        baseUrl: session.url,
        token: session.token,
        clientVersion: this.clientVersion,
        fetchFn: singleAttempt({ fetchFn, timeoutMs: args.timeoutMs }),
      })
    }
    return createHarnessApiClient({
      url: session.url,
      token: session.token,
      clientVersion: this.clientVersion,
      fetchFn,
    })
  }

  private projectFor(scope: EMemoryScope): string | undefined {
    if (scope === EMemoryScope.Global) return undefined
    if (this.project === null) throw new MemoryUnavailable(NO_PROJECT)
    return this.project
  }

  private address(args: MemoryAddress): Address {
    const project = this.projectFor(args.scope)
    return { scope: args.scope, name: args.name, ...(project === undefined ? {} : { project }) }
  }

  private parseSummary(args: { body: unknown; procedure: string }): MemorySummary {
    const parsed = memorySummarySchema.safeParse(args.body)
    if (!parsed.success) throw malformed(args.procedure)
    return parsed.data
  }
}
