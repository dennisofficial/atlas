import { AccountStorePort, ClockPort, CredentialPort, ENoticeTone, NoticePort, NOTICE_WARN_MS } from '@dltech/atlas-core'

import { CloudManagedCredentialPort } from '../credentials/cloud-managed-credential-port'
import { fileAccountStore } from '../credentials/account-store'
import { atlasVaultFile, atlasVaultKeyFile } from '../credentials/paths'
import { SecretCipher } from '../credentials/secret-cipher'
import { FileSecretsStore } from '../secrets/file-secrets-store'
import { atlasSecretsFile } from '../secrets/paths'
import { builtinOauthClients } from '../credentials/oauth'
import { RefreshingCredentialPort } from '../credentials/refreshing-credential-port'
import { instanceCachingFactory, portToken, type DependencyContainer } from './injection'
import { CloudSessionStoreToken, LocalAccountStoreToken, LocalSecretsStoreToken, SecretsStoreToken, ServeSessionToken } from './tokens'

export function registerCloudManagedCredentials(args: {
  container: DependencyContainer
  clientVersion: (container: DependencyContainer) => string
}): void {
  const { container } = args
  container.register(LocalAccountStoreToken, {
    useFactory: instanceCachingFactory((resolver) => fileAccountStore({
      file: atlasVaultFile(), keyFile: atlasVaultKeyFile(), clock: resolver.resolve(portToken(ClockPort)),
    })),
  })
  container.register(portToken(AccountStorePort), {
    useFactory: instanceCachingFactory((resolver) => resolver.resolve(LocalAccountStoreToken)),
  })
  container.register(LocalSecretsStoreToken, {
    useFactory: instanceCachingFactory(() => new FileSecretsStore({
      file: atlasSecretsFile(), cipher: new SecretCipher(atlasVaultKeyFile()),
    })),
  })
  container.register(SecretsStoreToken, {
    useFactory: instanceCachingFactory((resolver) => resolver.resolve(LocalSecretsStoreToken)),
  })
  container.register(portToken(CredentialPort), {
    useFactory: instanceCachingFactory((resolver) => {
      const accounts = resolver.resolve(portToken(AccountStorePort))
      const clock = resolver.resolve(portToken(ClockPort))
      const local = new RefreshingCredentialPort({ accounts, clients: builtinOauthClients({ clock }), clock })
      return new CloudManagedCredentialPort({
        accounts,
        local,
        clock,
        clientVersion: args.clientVersion(resolver),
        onHandoffFailure: (error) => {
          if (!resolver.isRegistered(portToken(NoticePort), true)) return
          resolver.resolve(portToken(NoticePort)).notify({
            key: 'cloud:oauth-handoff', tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS,
            text: `Signed in to Atlas Cloud; OAuth handoff is pending. ${error.message}`,
          })
        },
        session: () => resolver.isRegistered(ServeSessionToken, true)
          ? resolver.resolve(ServeSessionToken)
          : resolver.resolve(CloudSessionStoreToken).read(),
      })
    }),
  })
}
