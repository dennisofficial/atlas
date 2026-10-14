import type {
  EExecutionLocation,
  EventLogPort,
  PlacementRecord,
  ThreadId,
  WorkspaceIdentity,
} from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../agents/registry/port'
import type { DeltaChannel } from '../channel/delta-channel'
import type { MessageIntake } from '../intake'
import type { TurnLedgerPort } from '../ledger/turn-ledger.port'
import type { TurnRunner } from '../loop/turn-runner.port'
import type { ServiceRegistryPort } from '../services/service-registry'
import type { ShellRegistryPort } from '../shells/shell-registry'
import type { RewindMachineryPort } from '../store/rewind-machinery'
import type { ThreadStorePort } from '../store/thread-store'
import type { CompactionPort } from '../store/compaction-port'
import type { MentionReader } from '../files/mention-reader'

import type { PlacementCommit, PlacementController } from './placement-controller'

export enum ERuntimeKind {
  Local = 'local',
  Cloud = 'cloud',
}

export type RuntimeBinding<Adapters> = {
  kind: ERuntimeKind
  cwd: string
  adapters: Adapters
  close?: (() => void) | undefined
  freeze?: ((args: { threadId: ThreadId }) => Promise<() => void>) | undefined
}

export type SessionRuntime = {
  runner: TurnRunner
  channel: DeltaChannel
  log: EventLogPort
  threads: ThreadStorePort
  ledger: TurnLedgerPort
  intake: MessageIntake | undefined
  shells: ShellRegistryPort
  agents: AgentRegistryPort
  services: ServiceRegistryPort
  rewindMachinery: RewindMachineryPort | undefined
  compaction?: CompactionPort | undefined
  workspace: WorkspaceIdentity
  files: MentionReader
  attachment: unknown
}

export type OwnerSnapshot<Adapters> = {
  threadId: ThreadId | undefined
  location: EExecutionLocation
  record: PlacementRecord | undefined
  binding: RuntimeBinding<Adapters> | undefined
  cwd: string
  bound: boolean
}

export type SessionOwner<Adapters> = {
  placement: PlacementController
  snapshot: () => OwnerSnapshot<Adapters>
  require: () => RuntimeBinding<Adapters>
  attaching: (threadId: ThreadId) => boolean
  current: () => EExecutionLocation
  subscribe: (listener: () => void) => () => void
  /**
   * Installs the binding a fresh cloud birth provisioned and commits the born-placed record in one
   * step: `work` receives the controller's commit handle, stages the binding, and the commit
   * publishes the placement — which is what installs the staged binding. Birth is the only writer
   * of a cloud placement; there is no move transaction to ride.
   */
  install: <T>(args: {
    threadId: ThreadId
    prepareRuntime: (binding: RuntimeBinding<Adapters>) => void
    work: (commit: PlacementCommit) => Promise<T>
  }) => Promise<T>
  adopt: (args: {
    threadId: ThreadId
    binding: RuntimeBinding<Adapters>
  }) => Promise<void>
  activateLocal: (args: {
    threadId: ThreadId
    binding?: RuntimeBinding<Adapters> | undefined
    fallback?: EExecutionLocation | undefined
  }) => Promise<void>
  detach: (args: { threadId: ThreadId }) => void
}
