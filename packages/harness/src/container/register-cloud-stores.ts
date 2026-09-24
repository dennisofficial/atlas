import { ClockPort } from '@dltech/atlas-core'

import { CloudSessionStore } from '../cloud/cloud-session'
import { CloudSettingsStore } from '../cloud/cloud-settings-store'
import { atlasCloudFile, atlasVaultKeyFile } from '../credentials/paths'

import { instanceCachingFactory, portToken, type DependencyContainer } from './injection'
import { CloudSessionStoreToken, CloudSettingsStoreToken } from './tokens'

export function registerCloudStores(args: {
  container: DependencyContainer
  clientVersion: (resolver: DependencyContainer) => string
}): void {
  const { container } = args

  container.register(CloudSessionStoreToken, {
    useFactory: instanceCachingFactory(
      () => new CloudSessionStore({ file: atlasCloudFile(), keyFile: atlasVaultKeyFile() }),
    ),
  })

  container.register(CloudSettingsStoreToken, {
    useFactory: instanceCachingFactory(
      (resolver) =>
        new CloudSettingsStore({
          sessions: resolver.resolve(CloudSessionStoreToken),
          clock: resolver.resolve(portToken(ClockPort)),
          clientVersion: args.clientVersion(resolver),
        }),
    ),
  })
}
