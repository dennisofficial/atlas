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

import { CloudError, CloudTransport } from './cloud-transport'

const BUNDLES_PATH = '/v1/published-bundles'

const malformed = (args: { path: string; what: string }): CloudError =>
  new CloudError({
    status: 502,
    message: `The Atlas Cloud API answered ${args.path} with a body that is not ${args.what}.`,
  })

const parsed = <T>(args: {
  schema: z.ZodType<T>
  body: unknown
  path: string
  what: string
}): T => {
  const result = args.schema.safeParse(args.body)
  if (!result.success) throw malformed({ path: args.path, what: args.what })
  return result.data
}

export class PublishedBundleClient {
  private readonly transport: CloudTransport

  constructor(args: {
    url: string
    token: string
    clientVersion?: string | undefined
    fetchFn?: typeof fetch | undefined
  }) {
    this.transport = new CloudTransport(args)
  }

  async requestUpload(): Promise<PublishedBundleUpload> {
    const path = `${BUNDLES_PATH}/uploads`
    const body = await this.transport.request({ method: 'POST', path, retry: false })
    return parsed({
      schema: publishedBundleUploadSchema,
      body,
      path,
      what: 'a bundle upload grant',
    })
  }

  async commit(args: PublishedBundleCommit): Promise<PublishedBundleSummary> {
    const body = await this.transport.request({
      method: 'POST',
      path: BUNDLES_PATH,
      body: args,
      retry: false,
    })
    return parsed({
      schema: publishedBundleSummarySchema,
      body,
      path: BUNDLES_PATH,
      what: 'a bundle summary',
    })
  }

  async current(): Promise<PublishedBundleCurrent | null> {
    const path = `${BUNDLES_PATH}/current`
    const body = await this.transport.request({ method: 'GET', path, allowMissing: true })
    if (body === undefined) return null
    return parsed({ schema: publishedBundleCurrentSchema, body, path, what: 'the current bundle' })
  }
}
