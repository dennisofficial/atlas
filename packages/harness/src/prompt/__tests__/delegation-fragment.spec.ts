import { describe, expect, it } from 'bun:test'

import { EPromptAgent, type PromptContext } from '@dltech/atlas-core'

import { DelegationFragment } from '../fragments/agents'

const contextFor = (agent: EPromptAgent): PromptContext => ({
  agent,
  provider: { id: 'anthropic-oauth', modelId: 'claude-opus-5' },
  model: { contextWindow: 1_000_000 }, projectDirectory: '/w'
})

describe('the delegation fragment across the agent axis', () => {
  it('applies to the main session, which owns orchestration', () => {
    expect(new DelegationFragment().applies(contextFor(EPromptAgent.Main))).toBe(true)
  })

  it('is withheld from sub-agents, which cannot spawn', () => {
    expect(new DelegationFragment().applies(contextFor(EPromptAgent.Sub))).toBe(false)
  })

  it('anchors the keep-it-yourself line to a scale, not a feeling', () => {
    const text = new DelegationFragment().text()
    expect(text).toContain('smaller than the brief that would describe it')
  })

  it('names planned, sliced work as past the delegation line', () => {
    const text = new DelegationFragment().text()
    expect(text).toContain('plan file, a checklist, or')
    expect(text).toContain('go to agents now')
  })

  it('sends a remaining slice stack to a teammate', () => {
    const text = new DelegationFragment().text()
    expect(text).toContain('a remaining slice stack — goes to a')
  })
})
