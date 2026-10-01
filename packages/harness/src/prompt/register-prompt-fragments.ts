import { PromptFragment } from '@dltech/atlas-core'

import { SkillRegistryPort } from '../skills/port'
import { instanceCachingFactory, portToken, type DependencyContainer } from '../container/injection'
import { DelegationFragment } from './fragments/agents'
import { ExecutionLocationFragment, TodayFragment } from './fragments/environment'
import { AtlasIdentityFragment } from './fragments/identity'
import { AnswerInTextFragment } from './fragments/models'
import {
  CiteFileAndLineFragment,
  CutOrderFragment,
  LeadWithOutcomeFragment,
  OutputShapeFragment,
  ReadableBeatsTerseFragment,
} from './fragments/output'
import { TaskListFragment } from './fragments/plan'
import { DestructiveActionsFragment, GitEtiquetteFragment } from './fragments/safety'
import {
  ConcernThenBuildFragment,
  DecisionsAreTheirsFragment,
  OpenQuestionsFragment,
  PaceFragment,
  PlanFirstFragment,
} from './fragments/scope'
import { BackgroundShellsFragment } from './fragments/shells'
import { SkillListingFragment } from './fragments/skills'
import {
  OperatorSeesImagesFragment,
  ParallelToolCallsFragment,
  PreferDedicatedToolsFragment,
} from './fragments/tools'
import { UntrustedWebContentFragment, WebResearchFragment } from './fragments/web'
import { InMemoryPromptRegistry, PromptRegistry } from './registry'

export function registerBuiltinPromptFragments({
  container,
}: {
  container: DependencyContainer
}): void {
  const fragments = [
    AtlasIdentityFragment,
    ConcernThenBuildFragment,
    PaceFragment,
    OpenQuestionsFragment,
    PlanFirstFragment,
    DecisionsAreTheirsFragment,
    TodayFragment,
    ExecutionLocationFragment,
    PreferDedicatedToolsFragment,
    ParallelToolCallsFragment,
    OperatorSeesImagesFragment,
    BackgroundShellsFragment,
    TaskListFragment,
    DelegationFragment,
    DestructiveActionsFragment,
    GitEtiquetteFragment,
    LeadWithOutcomeFragment,
    ReadableBeatsTerseFragment,
    OutputShapeFragment,
    CutOrderFragment,
    CiteFileAndLineFragment,
    SkillListingFragment,
    WebResearchFragment,
    UntrustedWebContentFragment,
    AnswerInTextFragment,
  ]

  for (const fragment of fragments) {
    if (fragment === SkillListingFragment) {
      container.register(portToken(PromptFragment), {
        useFactory: (resolver) =>
          new SkillListingFragment(resolver.resolve(portToken(SkillRegistryPort))),
      })
      continue
    }
    container.register(portToken(PromptFragment), { useClass: fragment })
  }

  container.register(portToken(PromptRegistry), {
    useFactory: instanceCachingFactory(
      (resolver) => new InMemoryPromptRegistry(resolver.resolveAll(portToken(PromptFragment))),
    ),
  })
}
