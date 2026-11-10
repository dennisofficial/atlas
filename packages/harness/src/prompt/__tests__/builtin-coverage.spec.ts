import { describe, expect, it } from 'bun:test'

import {
  ALL_PROMPT_GROUPS,
  NO_PROMPT_GROUPS,
  PromptFragment,
  deadFragmentIds,
  reachablePromptContexts,
  type PromptContext,
} from '@dltech/atlas-core'

import {
  createIsolatedContainer,
  portToken,
  registeredPortToken,
  resolveSet,
  type DependencyContainer,
} from '../../container/injection'
import { SkillRegistryPort } from '../../skills/port'
import { registerBuiltinPromptFragments } from '../register-prompt-fragments'
import { FakeSkillRegistry, fakeSkill } from './fake-skills'

const LONG_DESCRIPTION = 'covers one narrow kind of work and says exactly when it applies. '.repeat(
  20,
)

const CROWDED_SKILL_SHELF = Array.from({ length: 60 }, (_, at) =>
  fakeSkill({ name: `skill-${at}`, description: `${at} ${LONG_DESCRIPTION}` }),
)

const registered = (): DependencyContainer => {
  const container = createIsolatedContainer()
  registerBuiltinPromptFragments({ container })
  container.register(registeredPortToken(SkillRegistryPort), {
    useValue: new FakeSkillRegistry({ skills: CROWDED_SKILL_SHELF }),
  })
  return container
}

const builtinFragments = (): readonly PromptFragment[] =>
  resolveSet({ container: registered(), token: portToken(PromptFragment) })

const reachable = (): readonly PromptContext[] => [
  ...reachablePromptContexts({
    groupSets: [ALL_PROMPT_GROUPS, NO_PROMPT_GROUPS],
    providerIds: ['anthropic-oauth'],
    projectDirectory: '/w',
  }),
  {
    groups: ALL_PROMPT_GROUPS,
    provider: { id: 'inference', modelId: 'kimi-k3-fast' },
    projectDirectory: '/w',
  },
]

describe('no builtin fragment is prose no reachable context can select', () => {
  it('holds nothing dead across every sampled group set and provider', () => {
    expect(deadFragmentIds({ fragments: builtinFragments(), contexts: reachable() })).toEqual([])
  })
})
