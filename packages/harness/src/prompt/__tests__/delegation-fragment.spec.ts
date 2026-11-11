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
  projectDirectory: '/w',
})

describe('the delegation fragment across the agent axis', () => {
  it('applies to the main session, which owns orchestration', () => {
    expect(new DelegationFragment().applies(contextFor(ALL_PROMPT_GROUPS))).toBe(true)
  })

  it('is withheld from sub-agents, which cannot spawn', () => {
    expect(new DelegationFragment().applies(contextFor(NO_PROMPT_GROUPS))).toBe(false)
  })

  it('delegates by default and names the context window as the reason', () => {
    const text = new DelegationFragment().text()
    expect(text).toContain('Delegate by default')
    expect(text).toContain('context window is the scarce resource')
  })

  it('keeps only work smaller than its own brief, so anything with a plan goes out', () => {
    const text = new DelegationFragment().text()
    expect(text).toContain('smaller than the brief that would describe it')
    expect(text).toContain('Anything you would write a plan file')
    expect(text).toContain('not after you have built them yourself')
  })

  it('sends exploration out even when the task itself stays with the agent', () => {
    const text = new DelegationFragment().text()
    expect(text).toContain('Exploration is the clearest case')
    expect(text).toContain('even')
    expect(text).toContain('when the task itself stays yours')
    expect(text).toContain('pay none of the')
    expect(text).toContain('search in your own context')
  })

  it('cuts slices along seams and names the integration owner', () => {
    const text = new DelegationFragment().text()
    expect(text).toContain('seams, not layers')
    expect(text).toContain('who owns the integration')
    expect(text).toContain('Never leave an agent waiting on another.')
  })

  it('sends a whole workstream to a teammate and bounded slices to sub-agents', () => {
    const text = new DelegationFragment().text()
    expect(text).toContain('Bounded tasks go to sub-agents')
    expect(text).toContain('beside you belongs to a teammate')
    expect(text).toContain('verify the assembled whole yourself')
  })
})
