import { describe, expect, it } from 'bun:test'

import {
  EPromptAgent,
  ESkipReason,
  PromptFragment,
  deadFragmentIds,
  reachablePromptContexts,
  type PromptContext,
} from '@dltech/atlas-core'

import { createIsolatedContainer, portToken, resolveSet } from '../../container/injection'
import { GrillingCeremonyEnabledToken } from '../../container/tokens'
import { SkillRegistryPort } from '../../skills/port'
import { registerBuiltinPromptFragments } from '../register-prompt-fragments'
import { PromptRegistry } from '../registry'
import { FakeSkillRegistry } from './fake-skills'

const MAIN: PromptContext = {
  agent: EPromptAgent.Main,
  provider: { id: 'anthropic-oauth', modelId: 'claude-opus-5' },
  model: { contextWindow: 1_000_000 },
  projectDirectory: '/w',
}

const SUB: PromptContext = { ...MAIN, agent: EPromptAgent.Sub }

const registered = ({ grilling = false }: { grilling?: boolean } = {}) => {
  const container = createIsolatedContainer()
  container.register(GrillingCeremonyEnabledToken, { useValue: () => grilling })
  container.register(portToken(SkillRegistryPort), {
    useValue: new FakeSkillRegistry({ skills: [] }),
  })
  registerBuiltinPromptFragments({ container })
  return container
}

const compiled = (args?: { grilling?: boolean }) =>
  registered(args).resolve(portToken(PromptRegistry)).compile(MAIN)

describe('the context folder contract', () => {
  it('assigns ATLAS_CONTEXT_DIR its job to the main agent', () => {
    const part = compiled().parts.find((one) => one.id === 'environment.context-folder')
    expect(part).toBeDefined()
    expect(part?.text).toContain('plan.md')
    expect(part?.text).toContain('sections/')
    expect(part?.text).toContain('decisions.md')
    expect(part?.text).toContain('compaction')
  })

  it('never compiles into a sub-agent prompt', () => {
    const prompt = registered().resolve(portToken(PromptRegistry)).compile(SUB)
    expect(prompt.parts.some((part) => part.id === 'environment.context-folder')).toBe(false)
  })

  it('keeps the calibration valve so trivial work writes nothing', () => {
    const part = compiled().parts.find((one) => one.id === 'environment.context-folder')
    expect(part?.text).toContain('one-line fix writes nothing')
  })
})

describe('the grilling ceremony flag', () => {
  it('leaves the prompt byte-identical when the flag is off', () => {
    expect(compiled({ grilling: false }).blocks).toEqual(compiled().blocks)
    expect(compiled({ grilling: false }).skipped).toContainEqual({
      id: 'plan.grilling-ceremony',
      reason: ESkipReason.Empty,
    })
  })

  it('compiles the ceremony when the flag is on', () => {
    const part = compiled({ grilling: true }).parts.find(
      (one) => one.id === 'plan.grilling-ceremony',
    )
    expect(part).toBeDefined()
    expect(part?.text).toContain('grilling')
    expect(part?.text).toContain('recommended answer first')
    expect(part?.text).toContain('do not interrogate a typo')
  })

  it('never compiles into a sub-agent prompt even when on', () => {
    const prompt = registered({ grilling: true }).resolve(portToken(PromptRegistry)).compile(SUB)
    expect(prompt.parts.some((part) => part.id === 'plan.grilling-ceremony')).toBe(false)
  })

  it('recompiles when the flag flips inside a live registry', () => {
    let on = false
    const container = createIsolatedContainer()
    container.register(GrillingCeremonyEnabledToken, { useValue: () => on })
    container.register(portToken(SkillRegistryPort), {
      useValue: new FakeSkillRegistry({ skills: [] }),
    })
    registerBuiltinPromptFragments({ container })
    const registry = container.resolve(portToken(PromptRegistry))

    const off = registry.compile(MAIN)
    expect(off.parts.some((part) => part.id === 'plan.grilling-ceremony')).toBe(false)

    on = true
    const flipped = registry.compile(MAIN)
    expect(flipped.parts.some((part) => part.id === 'plan.grilling-ceremony')).toBe(true)
    expect(flipped.blocks).not.toEqual(off.blocks)
  })
})

describe('builtin registration with the flag bound', () => {
  it('selects every registered fragment in a reachable context', () => {
    const fragments = resolveSet({ container: registered(), token: portToken(PromptFragment) })
    expect(
      deadFragmentIds({
        fragments,
        contexts: [
          ...reachablePromptContexts({
            agents: Object.values(EPromptAgent),
            providerIds: ['anthropic-oauth'],
            projectDirectory: '/w',
          }),
          { ...MAIN, provider: { id: 'inference', modelId: 'kimi-k3-fast' } },
        ],
      }),
    ).toEqual([])
  })
})
