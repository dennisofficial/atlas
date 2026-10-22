import { EPromptAgent, type PromptContext } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { OperatorInputFragment } from '../fragments/tools'

const at = (agent: EPromptAgent): PromptContext => ({
  agent,
  provider: { id: 'anthropic-oauth', modelId: 'claude-sonnet-4-5' },
  model: { contextWindow: 200_000 },
  projectDirectory: '/w',
})

describe('operator input guidance', () => {
  it('points at the tool with affirmative framing', () => {
    const text = new OperatorInputFragment().text()
    expect(text).toContain('operator_input')
    expect(text).toContain('ask for it with')
    expect(text).toContain('reuse')
    expect(text.toLowerCase()).not.toMatch(/\b(don't|do not|never use|avoid)\b/)
  })

  it('keeps FIFO and delivery mechanics outside system text', () => {
    const text = new OperatorInputFragment().text()
    expect(text).not.toContain('FIFO')
    expect(text).not.toContain('appendNewline')
    expect(text).not.toContain('exec 0<>')
    expect(text.length).toBeLessThan(350)
  })

  it('speaks only to the main session, which is the one that owns the tool', () => {
    const fragment = new OperatorInputFragment()
    expect(fragment.applies(at(EPromptAgent.Main))).toBe(true)
    expect(fragment.applies(at(EPromptAgent.Sub))).toBe(false)
  })
})
