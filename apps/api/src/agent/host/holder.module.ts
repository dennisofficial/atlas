import { Global, Module, type Provider } from '@nestjs/common'
import { ChangeContentStore, type ControlPlane } from '@dltech/atlas-control'
import type {
  HostBus,
  HostPresence,
  PodControlClient,
  SessionHolder,
  TerminalDemand,
} from '@dltech/atlas-host'
import type { LogPort, TracePort } from '@dltech/atlas-observability'

import { TRACE_FOR } from '../analytics/tokens'
import type { PgWakeListener } from '../bus/pg-wake-listener'
import { composeAgentHost } from '../compose'
import { MacLinkModule } from '../mac-link/mac-link.module'
import { MAC_LINK } from '../mac-link/port'
import type { MacLink } from '../mac-link/port'
import { podOpsOf } from './pod-ops'
import { POD_OPS, TERMINAL_DEMAND } from './tokens'
import type { ConfigSource } from '../config/agent-host-config'
import type { AgentHostEnv } from '../config/env'
import type { SandboxProviderRegistry } from '../sandbox/provider-registry'
import type { GithubTokenReader } from '../tokens/github-token-reader'
import type { ModelTokenService } from '../tokens/model-token-service'
import type { SigningKeyReader } from '../tokens/signing-key-reader'
import { UnavailableChangeContentStore } from '../../_lib/changes/change-content.provider'
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
    sandbox: SandboxProviderRegistry,
    config: ConfigSource,
    tokens: ModelTokenService,
    github: GithubTokenReader,
    signingKey: SigningKeyReader,
    media: MediaSignerSource,
    presence: HostPresence,
    control: PodControlClient,
    content: ChangeContentStore,
    log: LogPort,
    watch: HostWatchService,
    macLink: MacLink,
    traceFor: (distinctId: string) => TracePort,
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
      macLink,
      log,
      traceFor,
      onHostIdChanged: () => watch.recompute(),
      ...(media.signer === undefined ? {} : { media: media.signer }),
      ...(content instanceof UnavailableChangeContentStore ? {} : { changes: { content } }),
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
    ChangeContentStore,
    LOG,
    HOST_WATCH,
    MAC_LINK,
    TRACE_FOR,
  ],
}

const terminalDemandProvider: Provider = {
  provide: TERMINAL_DEMAND,
  useFactory: (holder: SessionHolder): TerminalDemand => holder.demandOf().terminal,
  inject: [HOLDER],
}

const podOpsProvider: Provider = {
  provide: POD_OPS,
  useFactory: (holder: SessionHolder) => podOpsOf({ holder }),
  inject: [HOLDER],
}

@Global()
@Module({
  imports: [ControlModule, RuntimeModule, MacLinkModule],
  providers: [hostWatchProvider, holderProvider, podOpsProvider, terminalDemandProvider],
  exports: [HOST_WATCH, HOLDER, POD_OPS, TERMINAL_DEMAND],
})
export class HolderModule {}
