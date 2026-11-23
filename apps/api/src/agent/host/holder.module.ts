import { Global, Module, type Provider } from '@nestjs/common'
import { ChangeContentStore, ContextContentStore, type ControlPlane } from '@dltech/atlas-control'
import type {
  HostBus,
  HostPresence,
  PodCallBus,
  PodControlClient,
  SessionHolder,
  TerminalDemand,
} from '@dltech/atlas-host'
import type { LogPort, TracePort } from '@dltech/atlas-observability'

import { TRACE_FOR } from '../analytics/tokens'
import { createPodMetricsBus, type PodMetricsBus } from '../bus/pod-metrics-bus'
import { PodMetricsRelay } from '../bus/pod-metrics-relay'
import type { PgWakeListener } from '../bus/pg-wake-listener'
import { composeAgentHost } from '../compose'
import { MacLinkModule } from '../mac-link/mac-link.module'
import { MAC_LINK } from '../mac-link/port'
import type { MacLink } from '../mac-link/port'
import { notifyDispatchOf } from './notify.port'
import { podOpsOf, type PodOps } from './pod-ops'
import { POD_METRICS_BUS, POD_METRICS_RELAY, POD_OPS, TERMINAL_DEMAND } from './tokens'
import type { ConfigSource } from '../config/agent-host-config'
import type { AgentHostEnv } from '../config/env'
import type { SandboxProviderRegistry } from '@dltech/atlas-pods/sandbox/provider-registry'
import type { GithubTokenReader } from '../tokens/github-token-reader'
import type { ModelTokenService } from '../tokens/model-token-service'
import type { SigningKeyReader } from '../tokens/signing-key-reader'
import { UnavailableChangeContentStore } from '../../_lib/changes/change-content.provider'
import {
  contextContentStoreProvider,
  UnavailableContextContentStore,
} from '../../_lib/changes/context-content.provider'
import { JobsProjectDispatcher } from '../../_core/ports/job-dispatcher'
import { ControlModule } from './control.module'
import { contextDirOf } from '../runtime/session-paths'
import { HostWatchService } from './host-watch-service'
import type { MediaSignerSource } from './media-signer-source'
import { RuntimeModule } from './runtime.module'
import { USAGE } from './tokens'
import type { UsageService } from '../usage/usage-service'
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
  POD_CALL_BUS,
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
    context: ContextContentStore,
    log: LogPort,
    watch: HostWatchService,
    macLink: MacLink,
    dispatcher: JobsProjectDispatcher,
    traceFor: (distinctId: string) => TracePort,
    usage: UsageService,
    podCallBus: PodCallBus,
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
      dispatcher,
      log,
      traceFor,
      podCallBus,
      notify: notifyDispatchOf({ dispatcher }),
      turnEnded: (args) => usage.refreshAfterTurn({ sessionId: args.sessionId }),
      onHostIdChanged: () => watch.recompute(),
      ...(media.signer === undefined ? {} : { media: media.signer }),
      ...(content instanceof UnavailableChangeContentStore ? {} : { changes: { content } }),
      ...(context instanceof UnavailableContextContentStore
        ? {}
        : { contextMirror: { content: context, contextDir: contextDirOf } }),
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
    ContextContentStore,
    LOG,
    HOST_WATCH,
    MAC_LINK,
    JobsProjectDispatcher,
    TRACE_FOR,
    USAGE,
    POD_CALL_BUS,
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

const podMetricsBusProvider: Provider = {
  provide: POD_METRICS_BUS,
  useFactory: (env: AgentHostEnv, log: LogPort): PodMetricsBus =>
    createPodMetricsBus({ url: env.redisUrl, log }),
  inject: [AGENT_HOST_ENV, LOG],
}

const podMetricsRelayProvider: Provider = {
  provide: POD_METRICS_RELAY,
  useFactory: (ops: PodOps, bus: PodMetricsBus, log: LogPort): PodMetricsRelay =>
    new PodMetricsRelay({ ops, bus, log }),
  inject: [POD_OPS, POD_METRICS_BUS, LOG],
}

@Global()
@Module({
  imports: [ControlModule, RuntimeModule, MacLinkModule],
  providers: [
    hostWatchProvider,
    holderProvider,
    podOpsProvider,
    podMetricsBusProvider,
    podMetricsRelayProvider,
    terminalDemandProvider,
    contextContentStoreProvider,
  ],
  exports: [
    HOST_WATCH,
    HOLDER,
    POD_OPS,
    POD_METRICS_BUS,
    POD_METRICS_RELAY,
    TERMINAL_DEMAND,
    ContextContentStore,
  ],
})
export class HolderModule {}
