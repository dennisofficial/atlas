import { describe, expect, it } from 'bun:test'

import {
  ALL_PROMPT_GROUPS,
  type PromptContext,
  NO_PROMPT_GROUPS,
  type EPromptGroup,
} from '@dltech/atlas-core'

import { DelegationFragment } from '../fragments/agents'

const contextFor = (groups: readonly EPromptGroup[]): PromptContext => ({
  groups,
  provider: { id: 'anthropic-oauth', modelId: 'claude-opus-5' },
  model: { contextWindow: 1_000_000 },
  projectDirectory: '/w',
})

describe('the delegation fragment across the agent axis', () => {
  it('applies to the main session, which owns orchestration', () => {
    expect(new DelegationFragment().applies(contextFor(ALL_PROMPT_GROUPS))).toBe(true)
  })

  it('is withheld from sub-agents, which cannot spawn', () => {
    expect(new DelegationFragment().applies(contextFor(NO_PROMPT_GROUPS))).toBe(false)
  })

  it('keeps coherent single-agent work with the agent doing it', () => {
    const text = new DelegationFragment().text()
    expect(text).toContain('one coherent change one agent can finish in a')
    expect(text).toContain('cost more than they save')
  })

  it('cuts slices along seams and names the integration owner', () => {
    const text = new DelegationFragment().text()
    expect(text).toContain('seams, not layers')
    expect(text).toContain('who owns the integration')
    expect(text).toContain('Never leave an agent waiting on another.')
  })

  it('sends a whole workstream to a teammate and bounded slices to sub-agents', () => {
    const text = new DelegationFragment().text()
    expect(text).toContain('a teammate for a whole workstream')
    expect(text).toContain('verify the assembled whole yourself')
  })
})
