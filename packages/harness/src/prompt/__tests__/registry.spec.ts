import { describe, expect, it } from 'bun:test'

import {
  ALL_PROMPT_GROUPS,
  ESkipReason,
  PromptFragment,
  deadFragmentIds,
  reachablePromptContexts,
  NO_PROMPT_GROUPS,
} from '@dltech/atlas-core'

import { InMemoryPromptRegistry } from '../registry'
import { ConditionalFragment, CountingFragment, SayingFragment, contextFor } from './fake-fragments'

const forModel = (modelId: string) => contextFor({ modelId })

const OPUS = forModel('claude-opus-5')
const INFERENCE = contextFor({ providerId: 'inference', modelId: 'kimi-k3' })

describe('InMemoryPromptRegistry', () => {
  it('compiles the fragments in registration order into one system block', () => {
    const registry = new InMemoryPromptRegistry([
      new SayingFragment('identity', 'first'),
      new SayingFragment('environment', 'second'),
    ])

    const compiled = registry.compile(OPUS)

    expect(compiled.parts.map((part) => part.id)).toEqual(['identity', 'environment'])
    expect(compiled.blocks).toEqual([{ text: 'first\n\nsecond' }])
  })

  it('reorders the prompt when the registration is reordered, and nothing else', () => {
    const registry = new InMemoryPromptRegistry([
      new SayingFragment('environment', 'second'),
      new SayingFragment('identity', 'first'),
    ])

    expect(registry.compile(OPUS).blocks).toEqual([{ text: 'second\n\nfirst' }])
  })

  it('measures each surviving part so a compile can be read as a budget', () => {
    const registry = new InMemoryPromptRegistry([new SayingFragment('identity', '  first  ')])

    expect(registry.compile(OPUS).parts).toEqual([{ id: 'identity', text: 'first', chars: 5 }])
  })

  it('skips a fragment whose applies is false, with Condition, and puts its text nowhere', () => {
    const registry = new InMemoryPromptRegistry([
      new SayingFragment('identity', 'kept'),
      new ConditionalFragment('thinking', 'dropped', () => false),
    ])

    const compiled = registry.compile(OPUS)

    expect(compiled.skipped).toEqual([{ id: 'thinking', reason: ESkipReason.Condition }])
    expect(compiled.blocks[0]?.text).toBe('kept')
    expect(compiled.parts.map((part) => part.id)).toEqual(['identity'])
  })

  it('skips a fragment whose text is empty or whitespace, with Empty', () => {
    const registry = new InMemoryPromptRegistry([
      new SayingFragment('nothing', ''),
      new SayingFragment('blank', '   \n  '),
      new SayingFragment('identity', 'kept'),
    ])

    const compiled = registry.compile(OPUS)

    expect(compiled.skipped).toEqual([
      { id: 'nothing', reason: ESkipReason.Empty },
      { id: 'blank', reason: ESkipReason.Empty },
    ])
    expect(compiled.blocks).toEqual([{ text: 'kept' }])
  })

  it('gives one registry two prompts when a fragment conditions on the provider', () => {
    const registry = new InMemoryPromptRegistry([
      new SayingFragment('identity', 'You are Atlas.'),
      new ConditionalFragment(
        'anthropic-only',
        'Advice for an Anthropic model.',
        (ctx) => ctx.provider.id === 'anthropic-oauth',
      ),
    ])

    expect(registry.compile(OPUS).blocks).toEqual([
      { text: 'You are Atlas.\n\nAdvice for an Anthropic model.' },
    ])
    expect(registry.compile(INFERENCE).blocks).toEqual([{ text: 'You are Atlas.' }])
    expect(registry.compile(INFERENCE).skipped).toEqual([
      { id: 'anthropic-only', reason: ESkipReason.Condition },
    ])
  })

  it('refuses two fragments under one id at construction, naming the collision', () => {
    expect(
      () =>
        new InMemoryPromptRegistry([
          new SayingFragment('identity.atlas', 'first'),
          new SayingFragment('identity.atlas', 'second'),
        ]),
    ).toThrow(/identity\.atlas/)
  })

  it('produces no block at all when it holds no fragments', () => {
    expect(new InMemoryPromptRegistry([]).compile(OPUS)).toEqual({
      blocks: [],
      parts: [],
      skipped: [],
    })
  })

  it('produces no block when every fragment it holds is skipped', () => {
    const registry = new InMemoryPromptRegistry([
      new ConditionalFragment('gated', 'never', () => false),
      new SayingFragment('blank', ''),
    ])

    expect(registry.compile(OPUS).blocks).toEqual([])
  })
})

describe('the compile memo', () => {
  it('compiles once for an equal context, since a fragment may have read the world', () => {
    const counting = new CountingFragment('counting')
    const registry = new InMemoryPromptRegistry([counting])

    registry.compile(OPUS)
    registry.compile(forModel('claude-opus-5'))

    expect(counting.calls).toBe(1)
  })

  it('recompiles for a different modelId, which is exactly when the provider cache went cold', () => {
    const counting = new CountingFragment('counting')
    const registry = new InMemoryPromptRegistry([counting])

    registry.compile(OPUS)
    registry.compile(forModel('claude-haiku-4-6'))

    expect(counting.calls).toBe(2)
    expect(registry.compile(forModel('claude-haiku-4-6')).blocks).toEqual([
      { text: 'compiled for claude-haiku-4-6' },
    ])
  })

  it('recompiles for a different provider under the same modelId', () => {
    const counting = new CountingFragment('counting')
    const registry = new InMemoryPromptRegistry([counting])

    registry.compile(contextFor({ modelId: 'claude-opus-5', providerId: 'anthropic-oauth' }))
    registry.compile(contextFor({ modelId: 'claude-opus-5', providerId: 'bedrock' }))

    expect(counting.calls).toBe(2)
  })

  it('keys on the provider modelId rather than the traits, so two ids of one window differ', () => {
    const counting = new CountingFragment('counting')
    const registry = new InMemoryPromptRegistry([counting])

    registry.compile(forModel('claude-haiku-4-5'))
    registry.compile(forModel('claude-haiku-4-6'))

    expect(counting.calls).toBe(2)
  })
})

describe('dead prose', () => {
  const idsThatAreDead = (args: {
    fragments: readonly PromptFragment[]
    providerIds: readonly string[]
  }): readonly string[] =>
    deadFragmentIds({
      fragments: args.fragments,
      contexts: reachablePromptContexts({
        groupSets: [ALL_PROMPT_GROUPS, NO_PROMPT_GROUPS],
        providerIds: args.providerIds,
        projectDirectory: '/w',
      }),
    })

  const anthropicOnly = (): PromptFragment =>
    new ConditionalFragment(
      'anthropic-only',
      'text',
      (ctx) => ctx.provider.id === 'anthropic-oauth',
    )

  it('names a fragment no reachable context can ever select', () => {
    const fragments = [
      new SayingFragment('identity', 'always'),
      new ConditionalFragment('never', 'unreachable', () => false),
    ]

    expect(idsThatAreDead({ fragments, providerIds: ['anthropic-oauth'] })).toEqual(['never'])
  })

  it('leaves a fragment alive when one sampled provider selects it', () => {
    expect(
      idsThatAreDead({ fragments: [anthropicOnly()], providerIds: ['anthropic-oauth'] }),
    ).toEqual([])
  })

  it('names a fragment dead when the sample never reaches the provider it is written for', () => {
    expect(idsThatAreDead({ fragments: [anthropicOnly()], providerIds: ['inference'] })).toEqual([
      'anthropic-only',
    ])
  })
})
