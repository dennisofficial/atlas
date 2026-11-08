import type { ThreadId } from '@dltech/atlas-core'

import type { CloudSession } from '../cloud/cloud-session'

import { composerUploadsClientFor } from '../cloud/composer-uploads-client'
import {
  instanceCachingFactory,
  registeredPortToken,
  type DependencyContainer,
} from '../container/injection'
import {
  ClientVersionToken,
  CloudSessionStoreToken,
  MediaUrlResolverToken,
  ServeSessionToken,
  SessionRegistryToken,
} from '../container/tokens'
import { MissingSaidUploads } from './missing-said-uploads'
import { ApiSaidUploads } from './said-uploads'
import { SaidUploadsPort } from './said-uploads.port'
import { uploadMediaUrls } from './upload-media-urls'

const sessionOf = (resolver: DependencyContainer): CloudSession | null =>
  resolver.isRegistered(ServeSessionToken, true)
    ? resolver.resolve(ServeSessionToken)
    : resolver.isRegistered(CloudSessionStoreToken, true)
      ? resolver.resolve(CloudSessionStoreToken).read()
      : null

const downloadsOf = (resolver: DependencyContainer, session: CloudSession) => {
  const client = composerUploadsClientFor({
    session,
    clientVersion: resolver.isRegistered(ClientVersionToken, true)
      ? resolver.resolve(ClientVersionToken)
      : 'dev',
  })
  return client.download.bind(client)
}

export function registerSaidUploads({ container }: { container: DependencyContainer }): void {
  container.register(registeredPortToken(SaidUploadsPort), {
    useFactory: instanceCachingFactory((resolver): SaidUploadsPort => {
      const session = sessionOf(resolver)
      if (session === null) return new MissingSaidUploads()

      const sessions = resolver.resolve(SessionRegistryToken)
      return new ApiSaidUploads({
        sessionDirOf: (threadId: ThreadId) => sessions.sessionDirFor({ threadId }),
        download: downloadsOf(resolver, session),
        fetchFn: fetch,
      })
    }),
  })
  container.register(MediaUrlResolverToken, {
    useFactory: instanceCachingFactory((resolver) => {
      const session = sessionOf(resolver)
      return session === null ? null : uploadMediaUrls({ download: downloadsOf(resolver, session) })
    }),
  })
}
