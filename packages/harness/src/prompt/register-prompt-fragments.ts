import { PromptFragment } from '@dltech/atlas-core'

import { SkillRegistryPort } from '../skills/port'
import { instanceCachingFactory, portToken, type DependencyContainer } from '../container/injection'
import { DelegationFragment } from './fragments/agents'
import { ExecutionLocationFragment, SessionPathsFragment, TodayFragment } from './fragments/environment'
import { AtlasIdentityFragment } from './fragments/identity'
import { AnswerInTextFragment } from './fragments/models'
import { CiteFileAndLineFragment, OutputShapeFragment } from './fragments/output'
import { TaskListFragment } from './fragments/plan'
import { DestructiveActionsFragment, GitEtiquetteFragment } from './fragments/safety'
import {
  AnswerHonestlyFragment,
  ConcernThenBuildFragment,
  EndTurnMessageFragment,
  InvestigateThenExplainFragment,
} from './fragments/scope'
import { BackgroundShellsFragment } from './fragments/shells'
import { SkillListingFragment } from './fragments/skills'
import {
  OperatorInputFragment,
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
    AnswerHonestlyFragment,
    InvestigateThenExplainFragment,
    EndTurnMessageFragment,
    TaskListFragment,
    TodayFragment,
    ExecutionLocationFragment,
    SessionPathsFragment,
    PreferDedicatedToolsFragment,
    ParallelToolCallsFragment,
    OperatorSeesImagesFragment,
    OperatorInputFragment,
    BackgroundShellsFragment,
    DelegationFragment,
    DestructiveActionsFragment,
    GitEtiquetteFragment,
    OutputShapeFragment,
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
