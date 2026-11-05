import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'

import { RandomIds } from './runtime/random-ids'
import { SessionHolder } from '@dltech/atlas-host'
import type { ControlPlane } from '@dltech/atlas-control'
import type { LogPort } from '@dltech/atlas-observability'

import type { ModelTokenService } from './tokens/model-token-service'
import type { GithubTokenReader } from './tokens/github-token-reader'
import type { ConfigSource } from './config/agent-host-config'
import type { AgentHostEnv } from './config/env'
import type { SandboxProvider } from './sandbox/sandbox-provider'
import { systemTimers, type HostBus, type HostTimers } from '@dltech/atlas-host'
import { createSessionRuntimeFactory } from './runtime/session-runtime-factory'

export type ComposeAgentHostArgs = {
  env: AgentHostEnv
  plane: ControlPlane
  bus: HostBus
  sandbox: SandboxProvider
  config: ConfigSource
  tokens: Pick<ModelTokenService, 'issue'>
  github: Pick<GithubTokenReader, 'read'>
  timers?: HostTimers | undefined
  log?: LogPort | undefined
  holderId?: string | undefined
}

export const composeAgentHost = (args: ComposeAgentHostArgs): SessionHolder => {
  const timers = args.timers ?? { now: () => Date.now(), ...systemTimers }
  return new SessionHolder({
    holderId: args.holderId ?? `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`,
    plane: args.plane,
    bus: args.bus,
    timers,
    runtimes: createSessionRuntimeFactory({
      config: args.config,
      tokens: args.tokens,
      github: args.github,
      sandbox: args.sandbox,
      daemonSecret: args.env.daemonSecret,
      timers,
      ...(args.log === undefined ? {} : { log: args.log }),
    }),
    ids: new RandomIds(),
    maxSessions: args.env.maxSessions,
    ...(args.log === undefined ? {} : { log: args.log }),
  })
}
