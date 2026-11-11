import type { ArtifactSpec } from '@dltech/atlas-artifacts'
import {
  artifactBeginPublishOutputSchema,
  artifactCommitPublishOutputSchema,
  artifactListOutputSchema,
  artifactSourceExportOutputSchema,
  type ArtifactSummary,
} from '@dltech/atlas-wire'

import { createApiClient, type ApiClient } from '@dltech/atlas-api-router'

import { cloudCall, createHarnessApiClient } from '../cloud/api-trpc-client'
import type { CloudSession } from '../cloud/cloud-session'
import { CloudError } from '../cloud/cloud-transport'

import {
  ArtifactPort,
  ArtifactRefused,
  ArtifactUnavailable,
  type ArtifactEntryInput,
  type ArtifactPublishBegun,
  type ArtifactPublishCommitted,
  type ArtifactSourceExport,
} from './artifact-port'

const SIGNED_OUT =
  'signing in to Atlas Cloud is what publishes an artifact: Atlas Cloud serves the URL and builds dist/ on its own machines, so a session that runs only on this machine has nowhere to publish to'

const BEGIN_PUBLISH_TIMEOUT_MS = 30_000
const COMMIT_PUBLISH_TIMEOUT_MS = 120_000

const REFUSAL_STATUSES: readonly number[] = [400, 404, 409, 422]
const REJECTED_SESSION_STATUSES: readonly number[] = [401, 403]

const malformed = (procedure: string): ArtifactUnavailable =>
  new ArtifactUnavailable(
    `The Atlas Cloud API answered ${procedure} with a body that is not an artifact answer, so nothing was published and nothing was read.`,
  )

const portFailureOf = (error: unknown): Error => {
  if (error instanceof ArtifactRefused || error instanceof ArtifactUnavailable) return error
  if (!(error instanceof CloudError)) {
    return error instanceof Error ? error : new Error(String(error))
  }
  if (REFUSAL_STATUSES.includes(error.status)) return new ArtifactRefused(error.message)
  if (REJECTED_SESSION_STATUSES.includes(error.status)) {
    return new ArtifactUnavailable(
      `${error.message} Atlas Cloud refused this session, so sign in again to publish.`,
    )
  }
  return new ArtifactUnavailable(error.message)
}

const singleAttempt = (args: { fetchFn: typeof fetch; timeoutMs: number }): typeof fetch =>
  Object.assign(
    (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      args.fetchFn(input, { ...init, signal: AbortSignal.timeout(args.timeoutMs) }),
    { preconnect: fetch.preconnect },
  )

export class CloudArtifactPort extends ArtifactPort {
  private readonly session: () => CloudSession | null
  private readonly clientVersion: string
  private readonly fetchFn: typeof fetch | undefined

  constructor(args: {
    session: () => CloudSession | null
    clientVersion: string
    fetchFn?: typeof fetch | undefined
  }) {
    super()
    this.session = args.session
    this.clientVersion = args.clientVersion
    this.fetchFn = args.fetchFn
  }

  async beginPublish(args: {
    slug?: string | undefined
    name?: string | undefined
    entries: ArtifactEntryInput[]
  }): Promise<ArtifactPublishBegun> {
    const client = this.client({ timeoutMs: BEGIN_PUBLISH_TIMEOUT_MS })
    const body = await this.attempted(() =>
      cloudCall(
        client.artifacts.beginPublish.mutate({
          entries: args.entries,
          ...(args.slug === undefined ? {} : { slug: args.slug }),
          ...(args.name === undefined ? {} : { name: args.name }),
        }),
      ),
    )
    const parsed = artifactBeginPublishOutputSchema.safeParse(body)
    if (!parsed.success) throw malformed('artifacts.beginPublish')
    return {
      artifactId: parsed.data.artifactId,
      slug: parsed.data.slug,
      version: parsed.data.version,
      uploads: parsed.data.uploads,
    }
  }

  async commitPublish(args: {
    artifactId: string
    version: number
    spec: ArtifactSpec
  }): Promise<ArtifactPublishCommitted> {
    const client = this.client({ timeoutMs: COMMIT_PUBLISH_TIMEOUT_MS })
    const body = await this.attempted(() =>
      cloudCall(
        client.artifacts.commitPublish.mutate({
          artifactId: args.artifactId,
          version: args.version,
          spec: args.spec,
        }),
      ),
    )
    const parsed = artifactCommitPublishOutputSchema.safeParse(body)
    if (!parsed.success) throw malformed('artifacts.commitPublish')
    return parsed.data
  }

  async list(): Promise<readonly ArtifactSummary[]> {
    const client = this.client()
    const body = await this.attempted(() => cloudCall(client.artifacts.list.query()))
    const parsed = artifactListOutputSchema.safeParse(body)
    if (!parsed.success) throw malformed('artifacts.list')
    return parsed.data.artifacts
  }

  async sourceExport(args: { slug: string }): Promise<ArtifactSourceExport> {
    const client = this.client()
    const body = await this.attempted(() =>
      cloudCall(client.artifacts.sourceExport.query({ slug: args.slug })),
    )
    const parsed = artifactSourceExportOutputSchema.safeParse(body)
    if (!parsed.success) throw malformed('artifacts.sourceExport')
    return { entries: parsed.data.entries }
  }

  async unpublish(args: { slug: string }): Promise<void> {
    const client = this.client()
    await this.attempted(() => cloudCall(client.artifacts.unpublish.mutate({ slug: args.slug })))
  }

  private async attempted<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error) {
      throw portFailureOf(error)
    }
  }

  private client(args?: { timeoutMs?: number | undefined }): ApiClient {
    const session = this.session()
    if (session === null) throw new ArtifactUnavailable(SIGNED_OUT)
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
}
