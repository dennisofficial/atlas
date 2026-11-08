import type { MediaUrlResolver } from '@dltech/atlas-core'

import { registeredPortToken, type DependencyContainer } from '../container/injection'
import { MediaUrlResolverToken } from '../container/tokens'
import { SaidUploadsPort } from './said-uploads.port'

export function turnUploadDeps(container: DependencyContainer): {
  uploads: SaidUploadsPort
  mediaUrls?: MediaUrlResolver
} {
  const uploads = container.resolve(registeredPortToken(SaidUploadsPort))
  const mediaUrls = container.isRegistered(MediaUrlResolverToken, true)
    ? container.resolve(MediaUrlResolverToken)
    : null
  return mediaUrls === null ? { uploads } : { uploads, mediaUrls }
}
