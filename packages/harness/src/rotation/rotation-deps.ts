import type { ClockPort, EventLogPort, IdPort } from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../agents/registry/port'
import type { TurnRunner } from '../loop/turn-runner.port'
import type { ServiceRegistryPort } from '../services/service-registry'
import type { ShellRegistryPort } from '../shells/shell-registry'
import type { SessionAuthorityPort } from '../store/sessions/meta'
import type { SessionRegistry } from '../store/sessions/registry'
import type { ThreadStorePort } from '../store/thread-store'

import type { RotationSummariser } from './handoff-summary'

export type RotationDeps = {
  authority: SessionAuthorityPort
  registry: SessionRegistry
  threads: ThreadStorePort
  log: EventLogPort
  ids: IdPort
  clock: ClockPort
  agents: AgentRegistryPort
  shells: ShellRegistryPort
  services: ServiceRegistryPort
  runner: TurnRunner
  summarise: RotationSummariser
  workspace: string
  repo: string | null
}
