import { describe, expect, it } from 'bun:test'

import { AUTO_MODEL } from '../../../fixtures/settings-agent'
import { roleModelOptions } from '../role-model-options'

const offered = [
  { id: 'anthropic/claude-opus-5', label: 'Claude Opus 5', provider: 'Anthropic' },
  { id: 'openai/gpt-5', label: 'GPT-5', provider: 'OpenAI' },
]

describe('roleModelOptions', () => {
  it('leads with Auto, then every model the composer offers', () => {
    const options = roleModelOptions({
      offered,
      autoLabel: 'Auto · Claude Opus',
      currentId: AUTO_MODEL,
    })
    expect(options.map((option) => option.id)).toEqual([
      AUTO_MODEL,
      'anthropic/claude-opus-5',
      'openai/gpt-5',
    ])
    expect(options[0]?.label).toBe('Auto · Claude Opus')
  })

  it('keeps a saved model that is no longer offered selectable', () => {
    const options = roleModelOptions({ offered, autoLabel: 'Auto', currentId: 'openai/gpt-4o' })
    expect(options.at(-1)).toEqual({ id: 'openai/gpt-4o', label: 'openai/gpt-4o' })
  })
})
