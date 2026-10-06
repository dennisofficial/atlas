import { describe, expect, it } from 'bun:test'

import { EDefinitionOrigin, EPromptAgent, promptContextFor, type PromptContext } from '@dltech/atlas-core'

import { subAgentPrompt } from '../../agents/registry/child-prompt'
import { BUILT_IN_AGENT_TYPES } from '../../agents/types/built-ins'
import { createIsolatedContainer, portToken } from '../../container/injection'
import { GrillingCeremonyEnabledToken } from '../../container/tokens'
import { SkillRegistryPort } from '../../skills/port'
import { registerBuiltinPromptFragments } from '../register-prompt-fragments'
import { PromptRegistry } from '../registry'
import { FakeSkillRegistry, fakeSkill } from './fake-skills'

const DIRECTIVE_LEAD = 'load ui-design before choosing an approach'
const BODY = 'UI_DESIGN_SOURCE_BODY_MARKER'

const PROVIDER = { id: 'anthropic-oauth', modelId: 'claude-opus-5' }
const MODEL = { contextWindow: 1_000_000 }

const contextFor = (args: { agent: EPromptAgent; projectDirectory?: string }): PromptContext =>
  promptContextFor({
    agent: args.agent,
    provider: PROVIDER,
    model: MODEL,
    projectDirectory: args.projectDirectory ?? '/w',
  })

const promptsOver = (skills: FakeSkillRegistry): PromptRegistry => {
  const container = createIsolatedContainer()
  container.register(GrillingCeremonyEnabledToken, { useValue: () => false })
  registerBuiltinPromptFragments({ container })
  container.register(portToken(SkillRegistryPort), { useValue: skills })
  return container.resolve(portToken(PromptRegistry))
}

const withUiDesign = (): FakeSkillRegistry =>
  new FakeSkillRegistry({
    skills: [fakeSkill({ name: 'research' }), fakeSkill({ name: 'ui-design', body: BODY })],
  })

const occurrences = ({ text, needle }: { text: string; needle: string }): number =>
  text.split(needle).length - 1

const textOf = ({ prompts, agent }: { prompts: PromptRegistry; agent: EPromptAgent }): string =>
  prompts.compile(contextFor({ agent })).blocks.map((block) => block.text).join('\n\n')

describe('the standing ui-design directive in the shipped prompt registry', () => {
  it('appears exactly once for main and sub-agent contexts', () => {
    const prompts = promptsOver(withUiDesign())

    for (const agent of Object.values(EPromptAgent)) {
      expect(occurrences({ text: textOf({ prompts, agent }), needle: DIRECTIVE_LEAD })).toBe(1)
    }
  })

  it('reaches every built-in agent type, teammates included', () => {
    const prompts = promptsOver(withUiDesign())

    for (const type of BUILT_IN_AGENT_TYPES) {
      const agent = type.name === 'teammate' ? EPromptAgent.Main : EPromptAgent.Sub
      const compiled = subAgentPrompt({
        prompts,
        agentType: { ...type, origin: EDefinitionOrigin.BuiltIn },
        provider: PROVIDER,
        model: MODEL,
        projectDirectory: '/w',
        agent,
      })
      const text = compiled.blocks.map((block) => block.text).join('\n\n')

      expect(occurrences({ text, needle: DIRECTIVE_LEAD })).toBe(1)
    }
  })

  it('stays out of the prompt without a model-invocable ui-design', () => {
    const absent = promptsOver(new FakeSkillRegistry({ skills: [fakeSkill({ name: 'research' })] }))
    const disabled = promptsOver(
      new FakeSkillRegistry({
        skills: [fakeSkill({ name: 'research' }), fakeSkill({ name: 'ui-design', modelInvocable: false })],
      }),
    )

    expect(textOf({ prompts: absent, agent: EPromptAgent.Main })).toContain('Load the skill that matches your task')
    expect(textOf({ prompts: absent, agent: EPromptAgent.Main })).not.toContain('ui-design')
    expect(textOf({ prompts: disabled, agent: EPromptAgent.Main })).not.toContain('ui-design')
  })

  it('keeps the system text byte-identical when the project directory moves', () => {
    const prompts = promptsOver(withUiDesign())
    const first = prompts.compile(contextFor({ agent: EPromptAgent.Main, projectDirectory: '/w' }))
    const moved = prompts.compile(
      contextFor({ agent: EPromptAgent.Main, projectDirectory: '/w/.atlas/worktrees/feature' }),
    )

    expect(moved.blocks).toEqual(first.blocks)
  })

  it('never preloads the skill body, leaving that to the skill tool', () => {
    expect(textOf({ prompts: promptsOver(withUiDesign()), agent: EPromptAgent.Main })).not.toContain(BODY)
  })

  it('does not depend on the advisory relevance hint, which is delivered outside the system prompt', () => {
    const prompts = promptsOver(withUiDesign())
    const before = textOf({ prompts, agent: EPromptAgent.Main })

    expect(before).toContain(DIRECTIVE_LEAD)
    expect(before).toContain('independently of the skill-relevance hint')
  })
})
