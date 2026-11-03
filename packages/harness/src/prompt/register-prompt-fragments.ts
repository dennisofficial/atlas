import { PromptFragment } from '@dltech/atlas-core'

import { SkillRegistryPort } from '../skills/port'
import { GrillingCeremonyEnabledToken } from '../container/tokens'
import {
  instanceCachingFactory,
  portToken,
  registeredPortToken,
  type DependencyContainer,
} from '../container/injection'
import { DelegationFragment } from './fragments/agents'
import { EnvelopeContractFragment } from './fragments/envelope-contract'
import { ContextFolderFragment } from './fragments/context-folder'
import { ExecutionLocationFragment, TodayFragment } from './fragments/environment'
import { GrillingCeremonyFragment } from './fragments/grilling'
import { AtlasIdentityFragment } from './fragments/identity'
import { AnswerInTextFragment } from './fragments/models'
import { CiteFileAndLineFragment, OutputShapeFragment } from './fragments/output'
import { TaskListFragment } from './fragments/plan'
import { DestructiveActionsFragment, GitEtiquetteFragment } from './fragments/safety'
import {
  AnswerHonestlyFragment,
  EndTurnMessageFragment,
  InvestigateThenExplainFragment,
  WorkLoopFragment,
} from './fragments/scope'
import { DeclaredServicesFragment } from './fragments/services'
import { SkillListingFragment } from './fragments/skills'
import { ServiceRegistryPort } from '../services/service-registry-port'
import { ParallelToolCallsFragment, PreferDedicatedToolsFragment } from './fragments/tools'
import { InMemoryPromptRegistry, PromptRegistry } from './registry'

export function registerBuiltinPromptFragments({
  container,
}: {
  container: DependencyContainer
}): void {
  const fragments = [
    AtlasIdentityFragment,
    EnvelopeContractFragment,
    AnswerHonestlyFragment,
    InvestigateThenExplainFragment,
    WorkLoopFragment,
    EndTurnMessageFragment,
    TaskListFragment,
    TodayFragment,
    ExecutionLocationFragment,
    DeclaredServicesFragment,
    ContextFolderFragment,
    PreferDedicatedToolsFragment,
    ParallelToolCallsFragment,
    DelegationFragment,
    DestructiveActionsFragment,
    GitEtiquetteFragment,
    OutputShapeFragment,
    CiteFileAndLineFragment,
    SkillListingFragment,
    AnswerInTextFragment,
  ]

  for (const fragment of fragments) {
    if (fragment === DeclaredServicesFragment) {
      container.register(portToken(PromptFragment), {
        useFactory: (resolver) =>
          new DeclaredServicesFragment(
            resolver.isRegistered(registeredPortToken(ServiceRegistryPort), true)
              ? resolver.resolve(registeredPortToken(ServiceRegistryPort))
              : undefined,
          ),
      })
      continue
    }
    if (fragment === SkillListingFragment) {
      container.register(portToken(PromptFragment), {
        useFactory: (resolver) =>
          new SkillListingFragment(resolver.resolve(registeredPortToken(SkillRegistryPort))),
      })
      continue
    }
    container.register(portToken(PromptFragment), { useClass: fragment })
  }

  container.register(portToken(PromptFragment), {
    useFactory: (resolver) =>
      new GrillingCeremonyFragment({
        ...(resolver.isRegistered(GrillingCeremonyEnabledToken, true)
          ? { enabled: resolver.resolve(GrillingCeremonyEnabledToken) }
          : {}),
      }),
  })

  container.register(registeredPortToken(PromptRegistry), {
    useFactory: instanceCachingFactory(
      (resolver) => new InMemoryPromptRegistry(resolver.resolveAll(portToken(PromptFragment))),
    ),
  })
}
