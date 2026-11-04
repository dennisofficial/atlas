import { describe, expect, it } from 'bun:test'

import { agentHostPrompt } from '../prompt'

const identity = { id: 'anthropic', modelId: 'claude-sonnet-4-5' }

describe('agentHostPrompt', () => {
  it('compiles the builtin fragments into a non-empty system prompt', () => {
    const prompt = agentHostPrompt({ identity })
    const compiled = prompt({ projectDirectory: '/workspace' })
    const text = compiled.blocks.map((block) => block.text).join('\n\n')
    expect(text.length).toBeGreaterThan(0)
    expect(text).toContain('You are Atlas')
  })

  it('memoizes the compiled prompt per project directory', () => {
    const prompt = agentHostPrompt({ identity })
    const first = prompt({ projectDirectory: '/workspace' })
    expect(prompt({ projectDirectory: '/workspace' })).toBe(first)
  })
})
