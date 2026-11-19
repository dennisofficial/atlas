import { RandomIds } from './runtime/random-ids'
import { composeCommands } from '@dltech/atlas-commands'
import {
  SessionHolder,
  TerminalDemand,
  type HostPresence,
  type PodControlClient,
} from '@dltech/atlas-host'
import { nativeCommandHandlers, nativeCommands } from '@dltech/atlas-native-commands'
import { cloudConfigStore } from './config/cloud-config-store'
import { envSecretsReader } from './config/env-secrets'
import { mcpControlPort } from './config/mcp-control'
import type { MacLink } from './mac-link/port'
import { SecretCipher } from './config/secret-cipher'
import { composedPlugins } from './registered-plugins'
import type { ChangeContentStore, ControlPlane } from '@dltech/atlas-control'
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
  sandbox: SandboxProvider
  config: ConfigSource
  tokens: Pick<ModelTokenService, 'issue'>
  github: Pick<GithubTokenReader, 'read'>
  signingKey: Pick<SigningKeyReader, 'read'>
  timers?: HostTimers | undefined
  log?: LogPort | undefined
  media?: MediaSigner | undefined
  changes?: { content: ChangeContentStore } | undefined
  presence: HostPresence
  control: PodControlClient
  macLink: MacLink
  onHostIdChanged?: (() => void) | undefined
}

export const composeAgentHost = (args: ComposeAgentHostArgs): SessionHolder => {
  const timers = args.timers ?? { now: () => Date.now(), ...systemTimers }
  const mcpControl = mcpControlPort(args.macLink)
  const cipher = new SecretCipher(args.env.secretsEncryptionKey)
  const terminalDemand = new TerminalDemand()
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
      configWrites: cloudConfigStore(),
      envSecrets: envSecretsReader(),
      terminalStreams: (sessionId) => terminalDemand.countOf(sessionId),
      ...(args.log === undefined ? {} : { log: args.log }),
    }),
    ids: new RandomIds(),
    isPermanentStartError,
    reasonOfStartError: startFailureReason,
    commands: composeCommands([...nativeCommands, ...composedPlugins.commands]),
    commandHandlers: new Map([...nativeCommandHandlers, ...composedPlugins.pod.commands]),
    control: args.control,
    mcp: (sessionId) => mcpControl.of(sessionId),
    operator: {
      sessionDir: sessionDirOf,
      openValue: (sealed) => cipher.decrypt(sealed),
    },
    ...(args.changes === undefined ? {} : { changes: args.changes }),
    terminalDemand,
    onHostIdChanged: args.onHostIdChanged,
    ...(args.log === undefined ? {} : { log: args.log }),
  })
}
