import { describe, expect, it } from 'bun:test'

import { EPromptAgent, ESkipReason, type PromptContext } from '@dltech/atlas-core'

import { SkillListingFragment } from '../fragments/skills'
import { InMemoryPromptRegistry } from '../registry'
import { SayingFragment } from './fake-fragments'
import { FakeSkillRegistry, fakeSkill } from './fake-skills'

const OPUS: PromptContext = {
  agent: EPromptAgent.Main,
  provider: { id: 'anthropic-oauth', modelId: 'claude-opus-5' },
  model: { contextWindow: 1_000_000 }, projectDirectory: '/w'
}

const CORPUS = [
  fakeSkill({ name: 'research', description: 'Investigate a question against primary sources' }),
  fakeSkill({
    name: 'grilling',
    description: 'Stress-test a plan',
    whenToUse: 'before committing',
  }),
  fakeSkill({ name: 'daily-update', description: 'Post the standup', modelInvocable: false }),
]

const fragmentOver = (registry: FakeSkillRegistry): SkillListingFragment =>
  new SkillListingFragment(registry)

const listingOver = (registry: FakeSkillRegistry): string => fragmentOver(registry).text(OPUS)

describe('the skill listing fragment', () => {
  it('lists a skill the model may invoke', () => {
    const text = listingOver(new FakeSkillRegistry({ skills: CORPUS }))

    expect(text).toContain('research')
    expect(text).toContain('grilling')
  })

  it('leaves out a skill that sets disable-model-invocation', () => {
    const text = listingOver(new FakeSkillRegistry({ skills: CORPUS }))

    expect(text).not.toContain('daily-update')
  })

  it('carries each summary, so the model can choose without loading anything', () => {
    const text = listingOver(new FakeSkillRegistry({ skills: CORPUS }))

    expect(text).toContain('Investigate a question against primary sources')
  })

  it('carries none of the skill bodies, which are the tool call', () => {
    const text = listingOver(new FakeSkillRegistry({ skills: CORPUS }))

    expect(text).not.toContain('Run the research procedure.')
  })

  it('places one affirmative instruction before the generated roster', () => {
    const text = listingOver(new FakeSkillRegistry({ skills: CORPUS }))

    expect(text.split('\n\n')[0]).toBe(
      'Load the skill that matches your task before choosing an approach.',
    )
    expect(text).not.toContain('not its neighbours')
  })

  it('emits nothing when no skill is model-invocable', () => {
    const text = listingOver(
      new FakeSkillRegistry({ skills: [fakeSkill({ name: 'private', modelInvocable: false })] }),
    )

    expect(text).toBe('')
  })

  it('emits nothing when no skill was discovered at all', () => {
    expect(listingOver(new FakeSkillRegistry({ skills: [] }))).toBe('')
  })

  it('applies to every agent the prompt is compiled for', () => {
    const fragment = fragmentOver(new FakeSkillRegistry({ skills: CORPUS }))

    for (const agent of Object.values(EPromptAgent)) {
      expect(fragment.applies({ ...OPUS, agent })).toBe(true)
    }
  })
})

const UI_DIRECTIVE =
  'For every task involving UI design, implementation, changes, or review—including web, mobile, and terminal interfaces—load ui-design before choosing an approach. Load it alongside any other relevant skills, independently of the skill-relevance hint.'

const occurrences = ({ text, needle }: { text: string; needle: string }): number =>
  text.split(needle).length - 1

describe('the standing ui-design directive', () => {
  const withUiDesign = [...CORPUS, fakeSkill({ name: 'ui-design', description: 'Design interfaces' })]

  it('follows the generic preamble exactly once when ui-design is model-invocable', () => {
    const text = listingOver(new FakeSkillRegistry({ skills: withUiDesign }))

    expect(text.split('\n\n').slice(0, 2)).toEqual([
      'Load the skill that matches your task before choosing an approach.',
      UI_DIRECTIVE,
    ])
    expect(occurrences({ text, needle: 'load ui-design' })).toBe(1)
  })

  it('leaves the generic preamble alone when ui-design is absent', () => {
    const text = listingOver(new FakeSkillRegistry({ skills: CORPUS }))

    expect(text).not.toContain('ui-design')
    expect(text.split('\n\n')[0]).toBe(
      'Load the skill that matches your task before choosing an approach.',
    )
  })

  it('does not name a ui-design that the model may not invoke', () => {
    const text = listingOver(
      new FakeSkillRegistry({
        skills: [...CORPUS, fakeSkill({ name: 'ui-design', modelInvocable: false })],
      }),
    )

    expect(text).not.toContain('ui-design')
  })

  it('does not ride on a skill that merely mentions ui-design', () => {
    const text = listingOver(
      new FakeSkillRegistry({
        skills: [fakeSkill({ name: 'better-ui', description: 'Polish; pairs with ui-design' })],
      }),
    )

    expect(text).not.toContain(UI_DIRECTIVE)
  })

  it('holds when the roster budget trims the ui-design entry itself', () => {
    const crowd = Array.from({ length: 400 }, (_, index) =>
      fakeSkill({ name: `crowd-${index}`, description: 'x'.repeat(300) }),
    )
    const text = fragmentOver(
      new FakeSkillRegistry({ skills: [...crowd, fakeSkill({ name: 'ui-design' })] }),
    ).text({ ...OPUS, model: { contextWindow: 20_000 } })

    expect(text).toContain(UI_DIRECTIVE)
    expect(occurrences({ text, needle: 'load ui-design' })).toBe(1)
  })

  it('keeps the preamble and directive when the budget leaves no room for the roster', () => {
    const text = fragmentOver(
      new FakeSkillRegistry({ skills: [fakeSkill({ name: 'ui-design' })] }),
    ).text({ ...OPUS, model: { contextWindow: 0 } })

    expect(text.split('\n\n').slice(0, 2)).toEqual([
      'Load the skill that matches your task before choosing an approach.',
      UI_DIRECTIVE,
    ])
  })

  it('is the same text for every agent the prompt compiles for', () => {
    const fragment = fragmentOver(new FakeSkillRegistry({ skills: withUiDesign }))
    const texts = Object.values(EPromptAgent).map((agent) => fragment.text({ ...OPUS, agent }))

    expect(new Set(texts).size).toBe(1)
    expect(texts[0]).toContain(UI_DIRECTIVE)
  })
})

describe('the listing compiled into a prompt', () => {
  const registryHolding = (skills: FakeSkillRegistry): InMemoryPromptRegistry =>
    new InMemoryPromptRegistry([
      new SayingFragment('identity', 'You are Atlas.'),
      fragmentOver(skills),
    ])

  it('sits alongside the rest of the preamble in one block', () => {
    const compiled = registryHolding(new FakeSkillRegistry({ skills: CORPUS })).compile(OPUS)

    expect(compiled.parts.map((part) => part.id)).toEqual(['identity', 'skills.listing'])
  })

  it('is skipped as empty when there is nothing to list', () => {
    const compiled = registryHolding(new FakeSkillRegistry({ skills: [] })).compile(OPUS)

    expect(compiled.skipped).toEqual([{ id: 'skills.listing', reason: ESkipReason.Empty }])
    expect(compiled.blocks).toEqual([{ text: 'You are Atlas.' }])
  })

  it('reflects a mid-session reload without the memo serving the old listing', async () => {
    const skills = new FakeSkillRegistry({
      skills: [fakeSkill({ name: 'research' })],
      onReload: () => [fakeSkill({ name: 'research' }), fakeSkill({ name: 'grilling' })],
    })
    const prompts = registryHolding(skills)

    expect(prompts.compile(OPUS).blocks[0]?.text).not.toContain('grilling')

    await skills.reload()

    expect(prompts.compile(OPUS).blocks[0]?.text).toContain('grilling')
  })

  it('appears once a reload finds the first model-invocable skill', async () => {
    const skills = new FakeSkillRegistry({
      skills: [],
      onReload: () => [fakeSkill({ name: 'research' })],
    })
    const prompts = registryHolding(skills)

    expect(prompts.compile(OPUS).parts.map((part) => part.id)).toEqual(['identity'])

    await skills.reload()

    expect(prompts.compile(OPUS).parts.map((part) => part.id)).toEqual([
      'identity',
      'skills.listing',
    ])
  })

  it('adds and removes the ui-design directive as availability changes across reloads', async () => {
    let present = false
    const skills = new FakeSkillRegistry({
      skills: [fakeSkill({ name: 'research' })],
      onReload: () =>
        present
          ? [fakeSkill({ name: 'research' }), fakeSkill({ name: 'ui-design' })]
          : [fakeSkill({ name: 'research' })],
    })
    const prompts = registryHolding(skills)
    const textOf = (): string => prompts.compile(OPUS).blocks[0]?.text ?? ''

    expect(textOf()).not.toContain(UI_DIRECTIVE)

    present = true
    await skills.reload()
    expect(textOf()).toContain(UI_DIRECTIVE)

    present = false
    await skills.reload()
    expect(textOf()).not.toContain(UI_DIRECTIVE)
  })
})
