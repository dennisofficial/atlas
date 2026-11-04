import {
  ALL_PROMPT_GROUPS,
  EExecutionLocation,
  ERunner,
  PromptFragment,
  promptContextFor,
  promptModelOf,
  type PromptSource,
  type ProviderIdentity,
} from '@dltech/atlas-core'
import {
  createIsolatedContainer,
  InMemoryPromptRegistry,
  portToken,
  registerBuiltinPromptFragments,
  registeredPortToken,
  SkillRegistryPort,
  type DiscoveredSkill,
} from '@dltech/atlas-harness'

class EmptySkillRegistry extends SkillRegistryPort {
  all(): readonly DiscoveredSkill[] {
    return []
  }

  byName(): DiscoveredSkill | undefined {
    return undefined
  }

  async reload(): Promise<readonly DiscoveredSkill[]> {
    return []
  }
}

const registryOf = (): InMemoryPromptRegistry => {
  const container = createIsolatedContainer()
  container.register(registeredPortToken(SkillRegistryPort), {
    useValue: new EmptySkillRegistry(),
  })
  registerBuiltinPromptFragments({ container })
  return new InMemoryPromptRegistry(container.resolveAll(portToken(PromptFragment)))
}

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
