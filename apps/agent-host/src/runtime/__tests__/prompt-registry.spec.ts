import { describe, expect, it } from 'bun:test'
import { ALL_PROMPT_GROUPS, ESkipReason, PromptFragment } from '@dltech/atlas-core'

import { PromptFragmentRegistry } from '../prompt-registry'

const ctx = {
  groups: ALL_PROMPT_GROUPS,
  provider: { id: 'anthropic', modelId: 'm' },
  projectDirectory: '/w',
}

class Saying extends PromptFragment {
  constructor(
    readonly id: string,
    private readonly saying: string,
  ) {
    super()
  }

  text(): string {
    return this.saying
  }
}

describe('PromptFragmentRegistry', () => {
  it('joins fragment text in registration order and skips empty fragments', () => {
    const registry = new PromptFragmentRegistry([
      new Saying('a', 'first'),
      new Saying('b', '  '),
      new Saying('c', 'third'),
    ])
    const compiled = registry.compile(ctx)
    expect(compiled.blocks[0]?.text).toBe('first\n\nthird')
    expect(compiled.skipped).toEqual([{ id: 'b', reason: ESkipReason.Empty }])
  })

  it('rejects two fragments with one id', () => {
    expect(() => new PromptFragmentRegistry([new Saying('a', 'x'), new Saying('a', 'y')])).toThrow(
      'two prompt fragments are registered as "a"',
    )
  })

  it('memoizes the compiled prompt for an unchanged context', () => {
    const registry = new PromptFragmentRegistry([new Saying('a', 'x')])
    expect(registry.compile(ctx)).toBe(registry.compile(ctx))
  })
})
