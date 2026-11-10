import { RandomIds } from './runtime/random-ids'
import { composeCommands } from '@dltech/atlas-commands'
import {
  SessionHolder,
  type HostPresence,
  type PodControlClient,
  type PodPeers,
} from '@dltech/atlas-host'
import { nativeCommandHandlers, nativeCommands } from '@dltech/atlas-native-commands'
import { mcpControlPort } from './config/mcp-control'
import { composedPlugins } from './registered-plugins'
import type { ControlPlane } from '@dltech/atlas-control'
import type { LogPort } from '@dltech/atlas-observability'

import type { ModelTokenService } from './tokens/model-token-service'
import type { GithubTokenReader } from './tokens/github-token-reader'
import type { SigningKeyReader } from './tokens/signing-key-reader'
import type { ConfigSource } from './config/agent-host-config'
import type { AgentHostEnv } from './config/env'
import type { MediaSigner } from './media/media-signer'
import type { SandboxProvider } from './sandbox/sandbox-provider'
import { systemTimers, type HostBus, type HostTimers } from '@dltech/atlas-host'
import { SessionNotFoundError } from './config/config-reader'
import { CredentialsUnavailableError } from './config/agent-host-credential-port'
import { startFailureReason } from './start-failure-reason'
import {
  createSessionRuntimeFactory,
  SandboxNotConfiguredError,
} from './runtime/session-runtime-factory'

export const isPermanentStartError = (error: unknown): boolean =>
  error instanceof SandboxNotConfiguredError ||
  error instanceof SessionNotFoundError ||
  error instanceof CredentialsUnavailableError

export type ComposeAgentHostArgs = {
  env: AgentHostEnv
  plane: ControlPlane
  bus: HostBus
  sandbox: SandboxProvider
  config: ConfigSource
  tokens: Pick<ModelTokenService, 'issue'>
  github: Pick<GithubTokenReader, 'read'>
  signingKey: Pick<SigningKeyReader, 'read'>
  timers?: HostTimers | undefined
  log?: LogPort | undefined
  media?: MediaSigner | undefined
  presence: HostPresence
  control: PodControlClient
  onHostIdChanged?: (() => void) | undefined
}

export const composeAgentHost = (args: ComposeAgentHostArgs): SessionHolder => {
  const timers = args.timers ?? { now: () => Date.now(), ...systemTimers }
  const podPeers: PodPeers = { placed: (params) => args.plane.podPeersPlaced(params) }
  const mcpControl = mcpControlPort()
  return new SessionHolder({
    presence: args.presence,
    plane: args.plane,
    bus: args.bus,
    timers,
    runtimes: createSessionRuntimeFactory({
      config: args.config,
      tokens: args.tokens,
      github: args.github,
      signingKey: args.signingKey,
      sandbox: args.sandbox,
      daemonSecret: args.env.daemonSecret,
      timers,
      media: args.media,
      plugins: composedPlugins,
      podPeers,
      ...(args.log === undefined ? {} : { log: args.log }),
    }),
    ids: new RandomIds(),
    podPeers,
    isPermanentStartError,
    reasonOfStartError: startFailureReason,
    maxSessions: args.env.maxSessions,
    commands: composeCommands([...nativeCommands, ...composedPlugins.commands]),
    commandHandlers: new Map([...nativeCommandHandlers, ...composedPlugins.pod.commands]),
    control: args.control,
    mcp: (sessionId) => mcpControl.of(sessionId),
    onHostIdChanged: args.onHostIdChanged,
    ...(args.log === undefined ? {} : { log: args.log }),
  })
}
