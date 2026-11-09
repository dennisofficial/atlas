import { hostname } from 'node:os'

import { Module, type Provider } from '@nestjs/common'
import type { Db } from '@dltech/atlas-db'
import type { HostPresence, PodControlClient } from '@dltech/atlas-host'
import type { LogPort } from '@dltech/atlas-observability'
import { CloudflareTunnelClient, PreviewTunnels } from '@dltech/atlas-previews'

import type { ConfigSource } from '../config/agent-host-config'
import { ConfigReader } from '../config/config-reader'
import { databaseUrlWithTls } from '../config/database-url'
import type { AgentHostEnv } from '../config/env'
import type { SecretCipher } from '../config/secret-cipher'
import { localPodControlOf } from '../control/local-pod-control'
import { createPgHostPresence } from '../presence/pg-host-presence'
import type { SandboxProvider } from '../sandbox/sandbox-provider'
import { VercelSandboxProvider } from '../sandbox/vercel-sandbox-provider'
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

const sandboxProvider: Provider = {
  provide: SANDBOX,
  useFactory: (env: AgentHostEnv): SandboxProvider =>
    new VercelSandboxProvider({
      image: env.sandboxImage,
      daemonBundle: { path: env.daemonBundlePath },
      daemonSecret: env.daemonSecret,
      cloudUrl: env.apiOrigin,
      log: (line) =>
        console.log(JSON.stringify({ level: 'info', source: 'sandbox', message: line })),
    }),
  inject: [AGENT_HOST_ENV],
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
  useFactory: (db: Db, previews: PreviewTunnels, cipher: SecretCipher): PodControlClient =>
    localPodControlOf({ db, previews, cipher }),
  inject: [DB, PREVIEWS, CIPHER],
}

const configProvider: Provider = {
  provide: CONFIG_SOURCE,
  useFactory: (env: AgentHostEnv, db: Db, cipher: SecretCipher): ConfigSource =>
    new ConfigReader({
      db,
      cipher,
      vercel: new VercelTokenRefresher({ db, cipher, oauth: env.vercelOauth }),
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
  providers: [...runtimeProviders],
  exports: [...runtimeExports],
})
export class RuntimeModule {}
