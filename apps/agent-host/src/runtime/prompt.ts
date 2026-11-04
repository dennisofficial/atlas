import {
  ALL_PROMPT_GROUPS,
  EExecutionLocation,
  ERunner,
  promptContextFor,
  promptModelOf,
  type PromptSource,
  type ProviderIdentity,
} from '@dltech/atlas-core'

import { AtlasIdentityFragment } from './prompt-fragments/identity'
import { DelegationFragment } from './prompt-fragments/agents'
import { EnvelopeContractFragment } from './prompt-fragments/envelope-contract'
import { ContextFolderFragment } from './prompt-fragments/context-folder'
import { ExecutionLocationFragment, TodayFragment } from './prompt-fragments/environment'
import { AnswerInTextFragment } from './prompt-fragments/models'
import { CiteFileAndLineFragment, OutputShapeFragment } from './prompt-fragments/output'
import { TaskListFragment } from './prompt-fragments/plan'
import { DestructiveActionsFragment, GitEtiquetteFragment } from './prompt-fragments/safety'
import {
  AnswerHonestlyFragment,
  EndTurnMessageFragment,
  InvestigateThenExplainFragment,
  WorkLoopFragment,
} from './prompt-fragments/scope'
import { ParallelToolCallsFragment, PreferDedicatedToolsFragment } from './prompt-fragments/tools'
import { PromptFragmentRegistry } from './prompt-registry'

const registryOf = (): PromptFragmentRegistry =>
  new PromptFragmentRegistry([
    new AtlasIdentityFragment(),
    new EnvelopeContractFragment(),
    new AnswerHonestlyFragment(),
    new InvestigateThenExplainFragment(),
    new WorkLoopFragment(),
    new EndTurnMessageFragment(),
    new TaskListFragment(),
    new TodayFragment(),
    new ExecutionLocationFragment(),
    new ContextFolderFragment(),
    new PreferDedicatedToolsFragment(),
    new ParallelToolCallsFragment(),
    new DelegationFragment(),
    new DestructiveActionsFragment(),
    new GitEtiquetteFragment(),
    new OutputShapeFragment(),
    new CiteFileAndLineFragment(),
    new AnswerInTextFragment(),
  ])

export const agentHostPrompt = (args: { identity: ProviderIdentity }): PromptSource => {
  const registry = registryOf()
  return ({ projectDirectory }) =>
    registry.compile(
      promptContextFor({
        groups: ALL_PROMPT_GROUPS,
        provider: args.identity,
        model: promptModelOf(undefined),
        projectDirectory,
        placement: EExecutionLocation.Cloud,
        runner: ERunner.Vercel,
      }),
    )
}
