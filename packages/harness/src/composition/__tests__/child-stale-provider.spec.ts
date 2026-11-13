import { afterEach, describe, expect, it } from 'bun:test'

import { EEffort, EModelFallbackReason } from '@dltech/atlas-core'

import { HookChain } from '../../hooks/registry'
import { childModelSelection, childModelSource } from '../child-model'
import type { ModelCatalogue } from '../model-catalogue'

import {
  askModel,
  childModelFixture,
  childType,
  cleanupHomes,
  CLAUDE,
  GPT,
  keyOf,
  pinSubagent,
  pinType,
  type ChildModelFixture,
} from './child-model-fixtures'
import { recordingNotices } from './fakes'

afterEach(cleanupHomes)

const depsOf = (args: { fixture: ChildModelFixture; models: ModelCatalogue }) => ({
  models: args.models,
  model: args.fixture.parent,
  threads: args.fixture.threads,
  settings: args.fixture.settings,
  hooks: () => new HookChain({}),
})

const withoutOpenAi = (models: ModelCatalogue): ModelCatalogue => ({
  ...models,
  reachable: (providerId) => providerId !== 'openai',
})

describe('a child spawned on a model no provider has an account for', () => {
  it("runs on the main agent's model and names the one it could not use", async () => {
    const fixture = await childModelFixture()
    pinType(fixture, { type: 'explore', ref: GPT })

    const spawned = await childModelSelection(
      depsOf({ fixture, models: withoutOpenAi(fixture.models) }),
    )({ agentType: childType({ name: 'explore' }), spawnedBy: fixture.threadId })

    expect(spawned.model).toEqual({ ref: keyOf(CLAUDE), effort: EEffort.Medium })
    expect(spawned.fellBack).toEqual({
      role: 'explore',
      from: { ref: keyOf(GPT), label: GPT.modelId },
      to: { ref: keyOf(CLAUDE), label: CLAUDE.modelId },
      reason: EModelFallbackReason.ProviderNotConnected,
    })
  })

  it('says nothing when the child runs the model it was given', async () => {
    const fixture = await childModelFixture()
    pinSubagent(fixture, GPT)

    const spawned = await childModelSelection(depsOf({ fixture, models: fixture.models }))({
      agentType: childType({ name: 'explore' }),
      spawnedBy: fixture.threadId,
    })

    expect(spawned.fellBack).toBeUndefined()
  })
})

describe('a child whose provider account is removed mid-run', () => {
  it("switches to the main agent's model and records it on the thread that spawned it", async () => {
    const fixture = await childModelFixture()
    pinSubagent(fixture, GPT)
    let openAiConnected = true
    const models: ModelCatalogue = {
      ...fixture.models,
      reachable: (providerId) => providerId === 'anthropic' || openAiConnected,
    }
    const notices = recordingNotices()
    const threadId = await fixture.newThread({ spawner: fixture.threadId })
    const source = childModelSource({
      ...depsOf({ fixture, models }),
      notice: notices.port,
      log: fixture.log,
      ids: fixture.ids,
    })

    const child = await source({ agentType: childType(), threadId })
    expect(child.identity).toEqual({ id: 'openai', modelId: GPT.modelId })

    openAiConnected = false

    expect(await askModel(child)).toBe('one')
    expect(child.identity).toEqual({ id: 'anthropic', modelId: CLAUDE.modelId })
    expect(notices.posts.map((post) => post.text)).toEqual(['child is running on claude-opus-5'])

    await Bun.sleep(10)
    const events = await fixture.log.read({ threadId: fixture.threadId })
    expect(events.at(-1)).toMatchObject({
      type: 'model-fell-back',
      agentId: threadId,
      role: 'child',
      from: { ref: keyOf(GPT), label: GPT.modelId },
      to: { ref: keyOf(CLAUDE), label: CLAUDE.modelId },
      reason: EModelFallbackReason.CredentialFailed,
    })
  })
})
