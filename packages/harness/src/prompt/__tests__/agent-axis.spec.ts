import { describe, expect, it } from 'bun:test'

import {
  ALL_PROMPT_GROUPS,
  type PromptContext,
  NO_PROMPT_GROUPS,
  type EPromptGroup,
} from '@dltech/atlas-core'

import { AtlasIdentityFragment } from '../fragments/identity'

const contextFor = (groups: readonly EPromptGroup[]): PromptContext => ({
  groups,
  provider: { id: 'anthropic-oauth', modelId: 'claude-opus-5' },
  model: { contextWindow: 1_000_000 },
  projectDirectory: '/w',
})

describe('the identity fragment across the agent axis', () => {
  it('tells the main agent who it is', () => {
    expect(new AtlasIdentityFragment().applies(contextFor(ALL_PROMPT_GROUPS))).toBe(true)
  })

  it('is withheld from a sub-agent, whose type supplies its identity instead', () => {
    expect(new AtlasIdentityFragment().applies(contextFor(NO_PROMPT_GROUPS))).toBe(false)
  })
})
