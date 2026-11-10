import { describe, expect, it } from 'bun:test'

import {
  ALL_PROMPT_GROUPS,
  EPromptGroup,
  NO_PROMPT_GROUPS,
  type PromptContext,
} from '@dltech/atlas-core'

import { createIsolatedContainer, registeredPortToken } from '../../container/injection'
import { GrillingCeremonyEnabledToken } from '../../container/tokens'
import { SkillRegistryPort } from '../../skills/port'
import { registerBuiltinPromptFragments } from '../register-prompt-fragments'
import { PromptRegistry } from '../registry'
import { FakeSkillRegistry } from './fake-skills'

const GROUPED_FRAGMENT_IDS: Record<Exclude<EPromptGroup, EPromptGroup.Memory>, string> = {
  [EPromptGroup.Identity]: 'identity.atlas',
  [EPromptGroup.Delegation]: 'agents.delegation',
  [EPromptGroup.ContextFolder]: 'environment.context-folder',
  [EPromptGroup.Grilling]: 'plan.grilling-ceremony',
}

const partIdsFor = (groups: readonly EPromptGroup[]): string[] => {
  const container = createIsolatedContainer()
  container.register(GrillingCeremonyEnabledToken, { useValue: () => true })
  registerBuiltinPromptFragments({ container })
  container.register(registeredPortToken(SkillRegistryPort), {
    useValue: new FakeSkillRegistry({ skills: [] }),
  })
  const ctx: PromptContext = {
    groups,
    provider: { id: 'anthropic-oauth', modelId: 'claude-opus-5' },
    projectDirectory: '/w',
  }
  return container
    .resolve(registeredPortToken(PromptRegistry))
    .compile(ctx)
    .parts.map((part) => part.id)
}

describe('prompt fragment groups', () => {
  it('gives the main agent and teammates every grouped fragment', () => {
    const ids = partIdsFor(ALL_PROMPT_GROUPS)

    for (const id of Object.values(GROUPED_FRAGMENT_IDS)) expect(ids).toContain(id)
  })

  it('gives sub-agents none of them', () => {
    const ids = partIdsFor(NO_PROMPT_GROUPS)

    for (const id of Object.values(GROUPED_FRAGMENT_IDS)) expect(ids).not.toContain(id)
  })

  it.each(Object.keys(GROUPED_FRAGMENT_IDS) as (keyof typeof GROUPED_FRAGMENT_IDS)[])(
    '%s gates exactly its own fragment',
    (group) => {
      const ids = partIdsFor([group])

      expect(ids).toContain(GROUPED_FRAGMENT_IDS[group])
      for (const other of Object.keys(
        GROUPED_FRAGMENT_IDS,
      ) as (keyof typeof GROUPED_FRAGMENT_IDS)[])
        if (other !== group) expect(ids).not.toContain(GROUPED_FRAGMENT_IDS[other])
    },
  )
})
