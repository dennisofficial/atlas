import { hostname } from 'node:os'

import { Module, type Provider } from '@nestjs/common'
import { ESandboxProvider } from '@dltech/atlas-protocol'
import { ChangeContentStore, ControlPlane } from '@dltech/atlas-control'
import type { Db } from '@dltech/atlas-db'
import type { HostPresence, PodControlClient } from '@dltech/atlas-host'
import type { LogPort } from '@dltech/atlas-observability'
import { CloudflareTunnelClient, PreviewTunnels } from '@dltech/atlas-previews'

import { changeContentStoreProvider } from '../../_lib/changes/change-content.provider'
import type { ConfigSource } from '../config/agent-host-config'
import { ConfigReader } from '../config/config-reader'
import { databaseUrlWithTls } from '../config/database-url'
import type { AgentHostEnv } from '../config/env'
import type { SecretCipher } from '../config/secret-cipher'
import { localPodControlOf } from '../control/local-pod-control'
import { ControlModule } from './control.module'
import { createPgHostPresence } from '../presence/pg-host-presence'
import { DAEMON_BUNDLE_ROUTE } from '../http/daemon-bundle'
import { sandboxRegistryOf, type SandboxProviderRegistry } from '../sandbox/provider-registry'
import type { SandboxProvider } from '../sandbox/sandbox-provider'
import { VercelSandboxProvider } from '../sandbox/vercel-sandbox-provider'
import { agent37InstanceIdsOf } from '../sandbox/agent37/agent37-instance-store'
import { Agent37SandboxProvider } from '../sandbox/agent37/agent37-sandbox-provider'
import { GithubTokenReader } from '../tokens/github-token-reader'
import { ModelTokenService } from '../tokens/model-token-service'
import { OauthConnectionStore } from '../tokens/oauth-connection-store'
import { SigningKeyReader } from '../tokens/signing-key-reader'
import { VercelTokenRefresher } from '../tokens/vercel-token-refresher'
import { MediaSignerSource } from './media-signer-source'
import {
  AGENT_HOST_ENV,
  CIPHER,
  CONFIG_SOURCE,
  CONTROL_PLANE,
  DB,
  GITHUB_TOKENS,
  LOG,
  MEDIA_SIGNER,
  MODEL_TOKENS,
  POD_CONTROL,
  PREVIEWS,
  PRESENCE,
  SANDBOX,
  SIGNING_KEYS,
} from './tokens'

const sandboxLog = (line: string): void => {
  console.log(JSON.stringify({ level: 'info', source: 'sandbox', message: line }))
}

const sandboxProvider: Provider = {
  provide: SANDBOX,
  useFactory: (env: AgentHostEnv, db: Db): SandboxProviderRegistry => {
    const adapters = new Map<ESandboxProvider, SandboxProvider>([
      [
        ESandboxProvider.Vercel,
        new VercelSandboxProvider({
          image: env.sandboxImage,
          daemonBundle: { path: env.daemonBundlePath },
          daemonSecret: env.daemonSecret,
          cloudUrl: env.apiOrigin,
          log: sandboxLog,
        }),
      ],
    ])
    const agent37 = env.agent37
    if (agent37 !== null) {
      adapters.set(
        ESandboxProvider.Agent37,
        new Agent37SandboxProvider({
          env: agent37,
          daemonBundle: { path: env.daemonBundlePath },
          daemonBundleUrl: `${env.publicUrl.replace(/\/$/, '')}/${DAEMON_BUNDLE_ROUTE}`,
          daemonSecret: env.daemonSecret,
          instances: agent37InstanceIdsOf(db),
          log: sandboxLog,
        }),
      )
    }
    return sandboxRegistryOf(adapters)
  },
  inject: [AGENT_HOST_ENV, DB],
}

const previewsProvider: Provider = {
  provide: PREVIEWS,
  useFactory: (env: AgentHostEnv, db: Db, cipher: SecretCipher): PreviewTunnels =>
    new PreviewTunnels({
      db,
      cipher,
      domain: env.previewDomain,
      cloudflare: new CloudflareTunnelClient({
        apiToken: env.cloudflare.apiToken,
        accountId: env.cloudflare.accountId,
        zoneId: env.cloudflare.zoneId,
      }),
    }),
  inject: [AGENT_HOST_ENV, DB, CIPHER],
}

const podControlProvider: Provider = {
  provide: POD_CONTROL,
  useFactory: (
    db: Db,
    previews: PreviewTunnels,
    cipher: SecretCipher,
    plane: ControlPlane,
  ): PodControlClient => localPodControlOf({ db, previews, cipher, plane }),
  inject: [DB, PREVIEWS, CIPHER, CONTROL_PLANE],
}

const configProvider: Provider = {
  provide: CONFIG_SOURCE,
  useFactory: (env: AgentHostEnv, db: Db, cipher: SecretCipher): ConfigSource =>
    new ConfigReader({
      db,
      cipher,
      vercel: new VercelTokenRefresher({ db, cipher, oauth: env.vercelOauth }),
      platform: { platformVercel: env.platformVercel, agent37: env.agent37 },
    }),
  inject: [AGENT_HOST_ENV, DB, CIPHER],
}

const githubTokensProvider: Provider = {
  provide: GITHUB_TOKENS,
  useFactory: (db: Db, cipher: SecretCipher): GithubTokenReader =>
    new GithubTokenReader({ db, cipher }),
  inject: [DB, CIPHER],
}

const signingKeysProvider: Provider = {
  provide: SIGNING_KEYS,
  useFactory: (db: Db, cipher: SecretCipher): SigningKeyReader =>
    new SigningKeyReader({ db, cipher }),
  inject: [DB, CIPHER],
}

const modelTokensProvider: Provider = {
  provide: MODEL_TOKENS,
  useFactory: (db: Db, cipher: SecretCipher): ModelTokenService =>
    new ModelTokenService({ store: new OauthConnectionStore(db), cipher }),
  inject: [DB, CIPHER],
}

const mediaSignerProvider: Provider = {
  provide: MEDIA_SIGNER,
  useFactory: (env: AgentHostEnv, db: Db, cipher: SecretCipher): MediaSignerSource =>
    new MediaSignerSource({ env, db, cipher }),
  inject: [AGENT_HOST_ENV, DB, CIPHER],
}

const presenceProvider: Provider = {
  provide: PRESENCE,
  useFactory: (env: AgentHostEnv, log: LogPort): HostPresence => {
    const presence = createPgHostPresence({
      url: databaseUrlWithTls(env.databaseDirectUrl),
      label: `${hostname()}-${process.pid}`,
      log,
    })
    presence.onLost((hostId) => {
      log.error({ source: 'presence', message: 'presence lost', data: { hostId } })
    })
    return presence
  },
  inject: [AGENT_HOST_ENV, LOG],
}

export const runtimeProviders: readonly Provider[] = [
  sandboxProvider,
  previewsProvider,
  podControlProvider,
  configProvider,
  githubTokensProvider,
  signingKeysProvider,
  modelTokensProvider,
  mediaSignerProvider,
  changeContentStoreProvider,
  presenceProvider,
]

export const runtimeExports: readonly symbol[] = [
  SANDBOX,
  PREVIEWS,
  POD_CONTROL,
  CONFIG_SOURCE,
  GITHUB_TOKENS,
  SIGNING_KEYS,
  MODEL_TOKENS,
  MEDIA_SIGNER,
  PRESENCE,
]

@Module({
  imports: [ControlModule],
  providers: [...runtimeProviders],
  exports: [...runtimeExports, ChangeContentStore],
})
export class RuntimeModule {}
