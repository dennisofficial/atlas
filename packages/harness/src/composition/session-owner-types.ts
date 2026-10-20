import type {
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
  placed: boolean
  record: PlacementRecord | undefined
  binding: RuntimeBinding<Adapters> | undefined
  bound: boolean
}

export type BirthInstall<Adapters> = PlacementCommit & {
  prepareRuntime: (binding: RuntimeBinding<Adapters>) => void
}

export type SessionOwner<Adapters> = {
  placement: PlacementController
  snapshot: () => OwnerSnapshot<Adapters>
  require: () => RuntimeBinding<Adapters>
  attaching: (threadId: ThreadId) => boolean
  subscribe: (listener: () => void) => () => void
  /**
   * Installs the binding a fresh cloud birth provisioned and commits the born-placed record in one
   * step: `work` stages the runtime through the handle's `prepareRuntime` and commits the
   * placement through its `commit`; the commit's publish installs the staged binding, so the
   * durable write and the runtime install land together. Birth is the only writer of a cloud
   * placement; there is no move transaction to ride.
   */
  install: <T>(args: {
    threadId: ThreadId
    work: (handle: BirthInstall<Adapters>) => Promise<T>
  }) => Promise<T>
  adopt: (args: {
    threadId: ThreadId
    binding: RuntimeBinding<Adapters>
  }) => Promise<void>
  detach: (args: { threadId: ThreadId }) => void
}
