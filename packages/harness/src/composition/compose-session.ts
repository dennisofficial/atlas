import type { EventLogPort, WorkspaceIdentity } from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../agents/registry/port'
import type { DeltaChannel } from '../channel/delta-channel'
import { holdFamilyIntake } from '../cloud/relocation/freeze-family'
import type { MessageIntake } from '../intake'
import type { TurnLedgerPort } from '../ledger/turn-ledger.port'
import type { TurnRunner } from '../loop/turn-runner.port'
import type { ServiceRegistryPort } from '../services/service-registry'
import type { ShellRegistryPort } from '../shells/shell-registry'
import type { ThreadStorePort } from '../store/thread-store'
import type { ContributedSurface } from '../plugins/surface'

import type { ExecutionLocationState } from './execution-location-state'
import { createSessionOwner, ERuntimeKind, type SessionOwner, type SessionRuntime } from './session-owner'

export function localSessionOwner(args: {
  placement: ExecutionLocationState
  workspace: WorkspaceIdentity
  runner: TurnRunner
  channel: DeltaChannel
  log: EventLogPort
  threads: ThreadStorePort
  ledger: TurnLedgerPort
  intake: MessageIntake | undefined
  shells: ShellRegistryPort
  agents: AgentRegistryPort
  services: ServiceRegistryPort
}): SessionOwner<SessionRuntime> {
  const { placement, workspace, threads, intake, ...held } = args

  return createSessionOwner<SessionRuntime>({
    placement,
    local: {
      kind: ERuntimeKind.Local,
      cwd: workspace.workspace,
      freeze: ({ threadId }) => holdFamilyIntake({ threadId, threads, intake }),
      adapters: {
        ...held,
        threads,
        intake,
        rewindMachinery: undefined,
        workspace,
        attachment: undefined,
      },
    },
  })
}

export const asPluginSurfaces = <TPluginSurface>(
  surfaces: readonly ContributedSurface[],
): readonly ContributedSurface<TPluginSurface>[] =>
  surfaces as unknown as readonly ContributedSurface<TPluginSurface>[]
