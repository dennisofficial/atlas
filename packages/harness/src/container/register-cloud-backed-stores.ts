import { AccountStorePort, ClockPort, NoticePort } from '@dltech/atlas-core'

import { AccountStoreProxy } from '../cloud/account-store-proxy'
import { SecretsStoreProxy } from '../cloud/secrets-store-proxy'

import { instanceCachingFactory, registeredPortToken, type DependencyContainer } from './injection'
import {
  CloudSessionStoreToken,
  LocalAccountStoreToken,
  LocalSecretsStoreToken,
  SecretsStoreToken,
} from './tokens'

export function registerCloudBackedStores(args: {
  container: DependencyContainer
  clientVersion: string
}): void {
  const { container, clientVersion } = args

  container.register(registeredPortToken(AccountStorePort), {
    useFactory: instanceCachingFactory(
      (resolver) =>
        new AccountStoreProxy({
          local: resolver.resolve(LocalAccountStoreToken),
          sessions: resolver.resolve(CloudSessionStoreToken),
          clientVersion,
          clock: resolver.resolve(registeredPortToken(ClockPort)),
        }),
    ),
  })

  container.register(SecretsStoreToken, {
    useFactory: instanceCachingFactory(
      (resolver) =>
        new SecretsStoreProxy({
          local: resolver.resolve(LocalSecretsStoreToken),
          sessions: resolver.resolve(CloudSessionStoreToken),
          clientVersion,
          notice: resolver.isRegistered(registeredPortToken(NoticePort), true)
            ? resolver.resolve(registeredPortToken(NoticePort))
            : undefined,
        }),
    ),
  })
}
