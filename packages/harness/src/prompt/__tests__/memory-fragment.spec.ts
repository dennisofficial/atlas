import { describe, expect, it } from 'vitest'

import { EPromptAgent, PromptFragment } from '@dltech/atlas-core'

import { createIsolatedContainer, portToken, registeredPortToken } from '../../container/injection'
import { newMemoryIndexState } from '../../memory/memory-index-state'
import { MemoryFragment } from '../fragments/memory'
import { registerBuiltinPromptFragments } from '../register-prompt-fragments'
import { PromptRegistry } from '../registry'
import { SkillRegistryPort } from '../../skills/port'
import { contextFor } from './fake-fragments'
import { FakeSkillRegistry } from './fake-skills'

const mainContext = contextFor({ modelId: 'claude-opus-5' })

describe('the memory fragment in the composed prompt', () => {
  it('reaches the compiled prompt even though it registers after the builtins', () => {
    const state = { ...newMemoryIndexState(), text: '### Global\n- a — b' }
    const container = createIsolatedContainer()
    container.register(registeredPortToken(SkillRegistryPort), {
      useValue: new FakeSkillRegistry({ skills: [] }),
    })
    registerBuiltinPromptFragments({ container })
    container.register(portToken(PromptFragment), { useValue: new MemoryFragment({ state }) })

    const compiled = container.resolve(registeredPortToken(PromptRegistry)).compile(mainContext)

    expect(compiled.parts.map((part) => part.id)).toContain('memory.instructions')
    expect(compiled.blocks.map((block) => block.text).join('\n')).toContain('- a — b')
  })

  it('names the memory tools and the index it renders', () => {
    const text = new MemoryFragment({ state: { ...newMemoryIndexState(), text: 'INDEX' } }).text()

    expect(text).toContain('write_memory')
    expect(text).toContain('read_memory')
    expect(text).toContain('## What you remember\n\nINDEX')
  })

  it('says the index is not loaded before the first turn', () => {
    const text = new MemoryFragment({ state: newMemoryIndexState() }).text()

    expect(text).toContain('Not loaded yet.')
  })

  it('is withheld from a sub-agent, so children never become concurrent writers', () => {
    const fragment = new MemoryFragment({ state: newMemoryIndexState() })

    expect(fragment.applies({ ...mainContext, agent: EPromptAgent.Main })).toBe(true)
    expect(fragment.applies({ ...mainContext, agent: EPromptAgent.Sub })).toBe(false)
  })
})
