import {
  AccountStorePort,
  CredentialAvailabilityPort,
  EAccountOrigin,
  type AccountId,
} from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../agents/registry/port'
import { AvailabilityControl, EAvailabilityAuthority } from '../model-recovery/availability-control'
import { ModelWaitStateToken } from '../model-recovery/wait-state-token'
import {
  CloudSessionStoreToken,
  LocalAccountStoreToken,
  ServeSessionToken,
} from '../container/tokens'
import { registeredPortToken, type DependencyContainer } from '../container/injection'

export function bindAvailabilityControl(args: {
  container: DependencyContainer
  agents: Pick<AgentRegistryPort, 'listEverywhere' | 'wake'>
}): AvailabilityControl {
  const { container, agents } = args
  const localVault = container.resolve(LocalAccountStoreToken)
  const authorityOf = async (accountId: AccountId): Promise<EAvailabilityAuthority> => {
    const local = await localVault.read(accountId)
    if (local?.origin === EAccountOrigin.Environment) return EAvailabilityAuthority.Local
    if (container.isRegistered(ServeSessionToken, true)) return EAvailabilityAuthority.Sandbox
    const signedIn =
      container.isRegistered(CloudSessionStoreToken, true) &&
      container.resolve(CloudSessionStoreToken).read() !== null
    return signedIn ? EAvailabilityAuthority.Cloud : EAvailabilityAuthority.Local
  }

  return new AvailabilityControl({
    availability: container.resolve(registeredPortToken(CredentialAvailabilityPort)),
    accounts: container.resolve(registeredPortToken(AccountStorePort)),
    localVault,
    waitState: container.resolve(ModelWaitStateToken),
    wakeChild: ({ threadId }) =>
      agents.listEverywhere().some((agent) => agent.agentId === threadId)
        ? agents.wake({ agentId: threadId })
        : undefined,
    authorityOf,
  })
}
