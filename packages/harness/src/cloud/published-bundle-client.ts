import type { ApiClient } from '@dltech/atlas-api-router'
import {
  publishedBundleCurrentSchema,
  publishedBundleSummarySchema,
  publishedBundleUploadSchema,
  type PublishedBundleCommit,
  type PublishedBundleCurrent,
  type PublishedBundleSummary,
  type PublishedBundleUpload,
} from '@dltech/atlas-wire'
import type { z } from 'zod'

import { cloudCall, createHarnessApiClient } from './api-trpc-client'
import { CloudError } from './cloud-transport'

const malformed = (args: { procedure: string; what: string }): CloudError =>
  new CloudError({
    status: 502,
    message: `The Atlas Cloud API answered ${args.procedure} with a body that is not ${args.what}.`,
  })

const parsed = <T>(args: {
  schema: z.ZodType<T>
  body: unknown
  procedure: string
  what: string
}): T => {
  const result = args.schema.safeParse(args.body)
  if (!result.success) throw malformed({ procedure: args.procedure, what: args.what })
  return result.data
}

export class PublishedBundleClient {
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

  async requestUpload(): Promise<PublishedBundleUpload> {
    const body = await cloudCall(this.api.publishedBundles.issueUpload.mutate())
    return parsed({
      schema: publishedBundleUploadSchema,
      body,
      procedure: 'publishedBundles.issueUpload',
      what: 'a bundle upload grant',
    })
  }

  async commit(args: PublishedBundleCommit): Promise<PublishedBundleSummary> {
    const body = await cloudCall(this.api.publishedBundles.commit.mutate(args))
    return parsed({
      schema: publishedBundleSummarySchema,
      body,
      procedure: 'publishedBundles.commit',
      what: 'a bundle summary',
    })
  }

  async current(): Promise<PublishedBundleCurrent | null> {
    const body = await cloudCall(this.api.publishedBundles.current.query(), {
      allowMissing: true,
    })
    if (body === undefined) return null
    return parsed({
      schema: publishedBundleCurrentSchema,
      body,
      procedure: 'publishedBundles.current',
      what: 'the current bundle',
    })
  }
}
