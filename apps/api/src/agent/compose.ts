import { RandomIds } from './runtime/random-ids'
import { composeCommands } from '@dltech/atlas-commands'
import {
  PanelDemand,
  SessionHolder,
  TerminalDemand,
  type HostPresence,
  type NotifyDispatch,
  type ParkArchivedPod,
  type PodControlClient,
} from '@dltech/atlas-host'
import {
  nativeCommandHandlers,
  nativeCommands,
  nativeControlHandlers,
} from '@dltech/atlas-native-commands'
import { cloudConfigStore } from './config/cloud-config-store'
import { envSecretsReader } from './config/env-secrets'
import { projectFilesSourceOf } from './config/project-files'
import { mcpControlPort } from './config/mcp-control'
import type { MacLink } from './mac-link/port'
import { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import { composedPlugins } from './registered-plugins'
import type { ChangeContentStore, ControlPlane } from '@dltech/atlas-control'
import type { LogPort, TracePort } from '@dltech/atlas-observability'

import type { ModelTokenService } from './tokens/model-token-service'
import type { GithubTokenReader } from './tokens/github-token-reader'
import type { SigningKeyReader } from './tokens/signing-key-reader'
import type { ConfigSource } from './config/agent-host-config'
import type { AgentHostEnv } from './config/env'
import type { MediaSigner } from './media/media-signer'
import type { SandboxProviderRegistry } from '@dltech/atlas-pods/sandbox/provider-registry'
import { systemTimers, type HostBus, type HostTimers } from '@dltech/atlas-host'
import { SessionNotFoundError } from './config/config-reader'
import { CredentialsUnavailableError } from './config/agent-host-credential-port'
import { sessionDirOf } from './runtime/session-paths'
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
  sandbox: SandboxProviderRegistry
  config: ConfigSource
  tokens: Pick<ModelTokenService, 'issue'>
  github: Pick<GithubTokenReader, 'read'>
  signingKey: Pick<SigningKeyReader, 'read'>
  timers?: HostTimers | undefined
  log?: LogPort | undefined
  traceFor?: ((distinctId: string) => TracePort) | undefined
  media?: MediaSigner | undefined
  changes?: { content: ChangeContentStore } | undefined
  presence: HostPresence
  control: PodControlClient
  macLink: MacLink
  notify?: NotifyDispatch | undefined
  parkArchived?: ParkArchivedPod | undefined
  onHostIdChanged?: (() => void) | undefined
}

export const composeAgentHost = (args: ComposeAgentHostArgs): SessionHolder => {
  const timers = args.timers ?? { now: () => Date.now(), ...systemTimers }
  const mcpControl = mcpControlPort(args.macLink)
  const cipher = new SecretCipher(args.env.secretsEncryptionKey)
  const terminalDemand = new TerminalDemand()
  const panelDemand = new PanelDemand()
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
      ...(args.traceFor === undefined ? {} : { traceFor: args.traceFor }),
      media: args.media,
      plugins: composedPlugins,
      configWrites: cloudConfigStore(),
      envSecrets: envSecretsReader(),
      projectFiles: projectFilesSourceOf(),
      terminalStreams: (sessionId) => terminalDemand.countOf(sessionId),
      panelHolds: (sessionId) => panelDemand.countOf(sessionId),
      podSizing: args.plane,
      sessions: args.plane,
      ...(args.log === undefined ? {} : { log: args.log }),
    }),
    ids: new RandomIds(),
    isPermanentStartError,
    reasonOfStartError: startFailureReason,
    commands: composeCommands([...nativeCommands, ...composedPlugins.commands]),
    commandHandlers: new Map([...nativeCommandHandlers, ...composedPlugins.pod.commands]),
    controlHandlers: nativeControlHandlers,
    control: args.control,
    mcp: (sessionId) => mcpControl.of(sessionId),
    operator: {
      sessionDir: sessionDirOf,
      openValue: (sealed) => cipher.decrypt(sealed),
    },
    ...(args.changes === undefined ? {} : { changes: args.changes }),
    ...(args.notify === undefined ? {} : { notify: args.notify }),
    ...(args.parkArchived === undefined ? {} : { parkArchived: args.parkArchived }),
    terminalDemand,
    panelDemand,
    onHostIdChanged: args.onHostIdChanged,
    ...(args.log === undefined ? {} : { log: args.log }),
  })
}
