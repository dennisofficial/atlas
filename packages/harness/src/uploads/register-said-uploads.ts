import type { ThreadId } from '@dltech/atlas-core'

import { composerUploadsClientFor } from '../cloud/composer-uploads-client'
import {
  instanceCachingFactory,
  registeredPortToken,
  type DependencyContainer,
} from '../container/injection'
import {
  ClientVersionToken,
  CloudSessionStoreToken,
  ServeSessionToken,
  SessionRegistryToken,
} from '../container/tokens'
import { MissingSaidUploads } from './missing-said-uploads'
import { ApiSaidUploads } from './said-uploads'
import { SaidUploadsPort } from './said-uploads.port'

export function registerSaidUploads({ container }: { container: DependencyContainer }): void {
  container.register(registeredPortToken(SaidUploadsPort), {
    useFactory: instanceCachingFactory((resolver): SaidUploadsPort => {
      const session = resolver.isRegistered(ServeSessionToken, true)
        ? resolver.resolve(ServeSessionToken)
        : resolver.isRegistered(CloudSessionStoreToken, true)
          ? resolver.resolve(CloudSessionStoreToken).read()
          : null
      if (session === null) return new MissingSaidUploads()

      const client = composerUploadsClientFor({
        session,
        clientVersion: resolver.isRegistered(ClientVersionToken, true)
          ? resolver.resolve(ClientVersionToken)
          : 'dev',
      })
      const sessions = resolver.resolve(SessionRegistryToken)
      return new ApiSaidUploads({
        sessionDirOf: (threadId: ThreadId) => sessions.sessionDirFor({ threadId }),
        download: (args) => client.download(args),
        fetchFn: fetch,
      })
    }),
  })
}
