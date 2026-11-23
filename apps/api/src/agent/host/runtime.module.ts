import { hostname } from 'node:os'

import { Module, type Provider } from '@nestjs/common'
import { ChangeContentStore, ControlPlane } from '@dltech/atlas-control'
import { livePodSessionsIn, podSessionIdOfThreadIn } from '@dltech/atlas-control/postgres'
import type { Db } from '@dltech/atlas-db'
import type { HostPresence, PodControlClient } from '@dltech/atlas-host'
import type { LogPort } from '@dltech/atlas-observability'
import {
  CloudflareTunnelClient,
  PreviewReconciler,
  PreviewTunnels,
  type PreviewReconcileDeps,
} from '@dltech/atlas-previews'

import { changeContentStoreProvider } from '../../_lib/changes/change-content.provider'
import type { ConfigSource } from '../config/agent-host-config'
import { configSourceOf } from '../config/config-source'
import { databaseUrlWithTls } from '../config/database-url'
import type { AgentHostEnv } from '../config/env'
import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import { localPodControlOf } from '../control/local-pod-control'
import { ControlModule } from './control.module'
import { createPgHostPresence } from '../presence/pg-host-presence'
import type { SandboxProviderRegistry } from '@dltech/atlas-pods/sandbox/provider-registry'
import { sandboxProvidersOf } from '@dltech/atlas-pods/sandbox/sandbox-providers'
import { GithubTokenReader } from '../tokens/github-token-reader'
import { ModelTokenService } from '../tokens/model-token-service'
import { OauthConnectionStore } from '../tokens/oauth-connection-store'
import { SigningKeyReader } from '../tokens/signing-key-reader'
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
  PREVIEW_RECONCILER,
  PRESENCE,
  SANDBOX,
  SIGNING_KEYS,
} from './tokens'

const sandboxProvider: Provider = {
  provide: SANDBOX,
  useFactory: (env: AgentHostEnv, db: Db): SandboxProviderRegistry =>
    sandboxProvidersOf({ env, db }),
  inject: [AGENT_HOST_ENV, DB],
}

const cloudflareOf = (env: AgentHostEnv): CloudflareTunnelClient =>
  new CloudflareTunnelClient({
    apiToken: env.cloudflare.apiToken,
    accountId: env.cloudflare.accountId,
    zoneId: env.cloudflare.zoneId,
  })

const livePeersOf =
  (db: Db) =>
  (podSessionId: string): Promise<number> =>
    db.transaction((tx) => livePodSessionsIn({ tx, podSessionId }))

const previewDepsOf = (args: {
  env: AgentHostEnv
  db: Db
  cipher: SecretCipher
}): PreviewReconcileDeps => ({
  db: args.db,
  cipher: args.cipher,
  domain: args.env.previewDomain,
  cloudflare: cloudflareOf(args.env),
  livePeersOf: livePeersOf(args.db),
})

const previewsProvider: Provider = {
  provide: PREVIEWS,
  useFactory: (env: AgentHostEnv, db: Db, cipher: SecretCipher): PreviewTunnels =>
    new PreviewTunnels({ ...previewDepsOf({ env, db, cipher }) }),
  inject: [AGENT_HOST_ENV, DB, CIPHER],
}

const previewReconcilerProvider: Provider = {
  provide: PREVIEW_RECONCILER,
  useFactory: (env: AgentHostEnv, db: Db, cipher: SecretCipher): PreviewReconciler =>
    new PreviewReconciler(previewDepsOf({ env, db, cipher })),
  inject: [AGENT_HOST_ENV, DB, CIPHER],
}

const podControlProvider: Provider = {
  provide: POD_CONTROL,
  useFactory: (
    db: Db,
    previews: PreviewTunnels,
    cipher: SecretCipher,
    plane: ControlPlane,
    reconciler: PreviewReconciler,
  ): PodControlClient =>
    localPodControlOf({
      db,
      previews,
      cipher,
      plane,
      reconciler,
      podOf: ({ threadId }) => db.transaction((tx) => podSessionIdOfThreadIn({ tx, threadId })),
    }),
  inject: [DB, PREVIEWS, CIPHER, CONTROL_PLANE, PREVIEW_RECONCILER],
}

const configProvider: Provider = {
  provide: CONFIG_SOURCE,
  useFactory: (env: AgentHostEnv, db: Db, cipher: SecretCipher): ConfigSource =>
    configSourceOf({ env, db, cipher }),
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
  previewReconcilerProvider,
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
