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

import type { ERecoveryAction } from './session-recovery'
import type { EPlacementMoveKind, PlacementController, PlacementTransaction } from './placement-controller'

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
  workspace: WorkspaceIdentity
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

export type OwnerTransaction<Adapters> = PlacementTransaction & {
  prepareRuntime: (binding?: RuntimeBinding<Adapters>) => void
}

export type SessionOwner<Adapters> = {
  placement: PlacementController
  snapshot: () => OwnerSnapshot<Adapters>
  require: () => RuntimeBinding<Adapters>
  attaching: (threadId: ThreadId) => boolean
  current: () => EExecutionLocation
  subscribe: (listener: () => void) => () => void
  move: <T>(args: {
    threadId: ThreadId
    target: EExecutionLocation
    kind: EPlacementMoveKind
    work: (transaction: OwnerTransaction<Adapters>) => Promise<T>
  }) => Promise<T>
  adopt: (args: {
    threadId: ThreadId
    binding: RuntimeBinding<Adapters>
    settle?: ((args: { record: PlacementRecord; action: ERecoveryAction }) => Promise<void>) | undefined
  }) => Promise<void>
  activateLocal: (args: {
    threadId: ThreadId
    binding?: RuntimeBinding<Adapters> | undefined
    fallback?: EExecutionLocation | undefined
  }) => Promise<void>
  detach: (args: { threadId: ThreadId }) => void
  recover: (args: {
    threadId: ThreadId
    prepare?: ((args: { record: PlacementRecord; action: ERecoveryAction }) => Promise<RuntimeBinding<Adapters>>) | undefined
  }) => Promise<PlacementRecord>
}
