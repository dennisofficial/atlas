import { Module, type Provider } from '@nestjs/common'
import type { ControlPlane } from '@dltech/atlas-control'
import type { HostBus, HostPresence, PodControlClient, SessionHolder } from '@dltech/atlas-host'
import type { LogPort } from '@dltech/atlas-observability'

import type { PgWakeListener } from '../bus/pg-wake-listener'
import { composeAgentHost } from '../compose'
import type { ConfigSource } from '../config/agent-host-config'
import type { AgentHostEnv } from '../config/env'
import type { SandboxProvider } from '../sandbox/sandbox-provider'
import type { GithubTokenReader } from '../tokens/github-token-reader'
import type { ModelTokenService } from '../tokens/model-token-service'
import type { SigningKeyReader } from '../tokens/signing-key-reader'
import { ControlModule } from './control.module'
import { HostWatchService } from './host-watch-service'
import type { MediaSignerSource } from './media-signer-source'
import { RuntimeModule } from './runtime.module'
import {
  AGENT_HOST_ENV,
  CONFIG_SOURCE,
  CONTROL_PLANE,
  GITHUB_TOKENS,
  HOLDER,
  HOST_BUS,
  HOST_WATCH,
  LOG,
  MEDIA_SIGNER,
  MODEL_TOKENS,
  POD_CONTROL,
  PRESENCE,
  SANDBOX,
  SIGNING_KEYS,
  WAKE_LISTENER,
} from './tokens'

const hostWatchProvider: Provider = {
  provide: HOST_WATCH,
  useFactory: (env: AgentHostEnv, wakes: PgWakeListener, log: LogPort): HostWatchService =>
    new HostWatchService({ env, wakes, log }),
  inject: [AGENT_HOST_ENV, WAKE_LISTENER, LOG],
}

const holderProvider: Provider = {
  provide: HOLDER,
  useFactory: (
    env: AgentHostEnv,
    plane: ControlPlane,
    bus: HostBus,
    sandbox: SandboxProvider,
    config: ConfigSource,
    tokens: ModelTokenService,
    github: GithubTokenReader,
    signingKey: SigningKeyReader,
    media: MediaSignerSource,
    presence: HostPresence,
    control: PodControlClient,
    log: LogPort,
    watch: HostWatchService,
  ): SessionHolder =>
    composeAgentHost({
      env,
      plane,
      bus,
      sandbox,
      config,
      tokens,
      github,
      signingKey,
      presence,
      control,
      log,
      onHostIdChanged: () => watch.recompute(),
      ...(media.signer === undefined ? {} : { media: media.signer }),
    }),
  inject: [
    AGENT_HOST_ENV,
    CONTROL_PLANE,
    HOST_BUS,
    SANDBOX,
    CONFIG_SOURCE,
    MODEL_TOKENS,
    GITHUB_TOKENS,
    SIGNING_KEYS,
    MEDIA_SIGNER,
    PRESENCE,
    POD_CONTROL,
    LOG,
    HOST_WATCH,
  ],
}

@Module({
  imports: [ControlModule, RuntimeModule],
  providers: [hostWatchProvider, holderProvider],
  exports: [HOST_WATCH, HOLDER],
})
export class HolderModule {}
