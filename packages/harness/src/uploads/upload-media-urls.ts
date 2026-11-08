import type { MediaUrlResolver } from '@dltech/atlas-core'

import type { UploadDownload } from './said-uploads'

const REUSE_MS = 10 * 60 * 1000

type Held = { url: string; until: number }

export function uploadMediaUrls(args: {
  download: UploadDownload
  now?: (() => number) | undefined
}): MediaUrlResolver {
  const now = args.now ?? Date.now
  const held = new Map<string, Held>()

  return {
    async urlOf({ ref, threadId }) {
      if ('hash' in ref) throw new Error('a media hash has no upload url on this surface')
      const reusable = held.get(ref.pathname)
      if (reusable !== undefined && reusable.until > now()) return reusable.url

      const grant = await args.download({ threadId, pathname: ref.pathname })
      if (!grant.found) throw new Error(`upload ${ref.uploadId} is no longer stored`)
      held.set(ref.pathname, { url: grant.downloadUrl, until: now() + REUSE_MS })
      return grant.downloadUrl
    },
  }
}
