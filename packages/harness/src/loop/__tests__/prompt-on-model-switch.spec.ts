import { describe, expect, it } from 'bun:test'

import {
  assemble,
  defaultPipeline,
  ALL_PROMPT_GROUPS,
  PromptFragment,
  promptContextFor,
  toThreadId,
  type PromptContext,
  type ProviderIdentity,
} from '@dltech/atlas-core'

import { InMemoryPromptRegistry } from '../../prompt/registry'

const PROJECT_DIRECTORY = '/w'

class IdentityFragment extends PromptFragment {
  readonly id = 'fixture.identity'

  text(): string {
    return 'You are Atlas.'
  }
}

class HaikuFragment extends PromptFragment {
  readonly id = 'fixture.haiku'

  override applies(ctx: PromptContext): boolean {
    return ctx.provider.modelId === 'claude-haiku-4-5'
  }

  text(): string {
    return 'Spend the context carefully; Haiku has less of it.'
  }
}

class CountingFragment extends PromptFragment {
  readonly id = 'fixture.counting'

  calls = 0

  text(): string {
    this.calls += 1
    return `compiled ${this.calls} time(s)`
  }
}

const ctxFor = (provider: ProviderIdentity) => ({
  events: [],
  threadId: toThreadId('thread-fixture'),
  step: 0,
  provider,
})

const OPUS: ProviderIdentity = { id: 'anthropic', modelId: 'claude-opus-5' }
const HAIKU: ProviderIdentity = { id: 'anthropic', modelId: 'claude-haiku-4-5' }

const systemFor = (args: {
  registry: InMemoryPromptRegistry
  provider: ProviderIdentity
}): readonly string[] => {
  const pipeline = defaultPipeline({
    prompt: () =>
      args.registry.compile(
        promptContextFor({
          groups: ALL_PROMPT_GROUPS,
          provider: args.provider,
          projectDirectory: '/w',
        }),
      ),
    launchDirectory: PROJECT_DIRECTORY,
  })

  return assemble({
    ...pipeline,
    ctx: ctxFor(args.provider),
  }).assembled.system.map((block) => block.text)
}

describe('a model switch, seen through the pipeline the composition root built once', () => {
  it('emits the fragments the newly selected model calls for, without a new pipeline', () => {
    const registry = new InMemoryPromptRegistry([new IdentityFragment(), new HaikuFragment()])
    let provider: ProviderIdentity = OPUS

    const pipeline = defaultPipeline({
      prompt: ({ projectDirectory }) =>
        registry.compile(
          promptContextFor({
            groups: ALL_PROMPT_GROUPS,
            provider,
            projectDirectory,
          }),
        ),
      launchDirectory: PROJECT_DIRECTORY,
    })

    const onOpus = assemble({ ...pipeline, ctx: ctxFor(provider) }).assembled.system
    provider = HAIKU
    const onHaiku = assemble({ ...pipeline, ctx: ctxFor(provider) }).assembled.system

    expect(onOpus.map((block) => block.text)).toEqual(['You are Atlas.'])
    expect(onHaiku.map((block) => block.text)).toEqual([
      'You are Atlas.\n\nSpend the context carefully; Haiku has less of it.',
    ])
  })

  it('compiles once per model rather than once per assembly, so a turn is never a rebuild', () => {
    const counting = new CountingFragment()
    const registry = new InMemoryPromptRegistry([counting])

    systemFor({ registry, provider: OPUS })
    systemFor({ registry, provider: OPUS })
    systemFor({ registry, provider: OPUS })

    expect(counting.calls).toBe(1)

    systemFor({ registry, provider: HAIKU })

    expect(counting.calls).toBe(2)
  })
})
