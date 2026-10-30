import type { ApiClient } from '@dltech/atlas-api-router'
import {
  composerUploadDownloadReplySchema,
  type ComposerUploadDownloadInput,
  type ComposerUploadDownloadReply,
} from '@dltech/atlas-wire'

import { cloudCall, createHarnessApiClient } from './api-trpc-client'
import { CloudError } from './cloud-transport'
import type { CloudSession } from './cloud-session'

export class ComposerUploadsClient {
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

  async download(args: ComposerUploadDownloadInput): Promise<ComposerUploadDownloadReply> {
    const body = await cloudCall(this.api.composerUploads.download.mutate(args))
    const result = composerUploadDownloadReplySchema.safeParse(body)
    if (!result.success) {
      throw new CloudError({
        status: 502,
        message:
          'The Atlas Cloud API answered composerUploads.download with a body that is not a download grant.',
      })
    }
    return result.data
  }
}

export const composerUploadsClientFor = (args: {
  session: CloudSession
  clientVersion?: string | undefined
  fetchFn?: typeof fetch | undefined
}): ComposerUploadsClient =>
  new ComposerUploadsClient({
    url: args.session.url,
    token: args.session.token,
    clientVersion: args.clientVersion,
    fetchFn: args.fetchFn,
  })
