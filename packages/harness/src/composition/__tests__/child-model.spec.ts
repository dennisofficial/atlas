import { afterEach, describe, expect, it } from 'bun:test'

import { APICallError } from '@ai-sdk/provider'
import { EEffort, toThreadId } from '@dltech/atlas-core'

import { HookChain } from '../../hooks/registry'
import { childModelSource } from '../child-model'
import type { ModelCatalogue } from '../model-catalogue'
import { selectableModel } from '../model-selection'

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
} from './child-model-fixtures'

afterEach(cleanupHomes)

describe('childModelSource', () => {
  it('streams the parent provider and keeps identity, traits and effort across a cross-provider parent switch', async () => {
    const fixture = await childModelFixture()
    const child = await fixture.spawn()

    expect(child.identity).toEqual({ id: 'anthropic', modelId: CLAUDE.modelId })
    expect(child.traits?.().contextWindow).toBe(200_000)
    expect(await askModel(child)).toBe('one')

    fixture.parent.select({ ref: GPT, effort: EEffort.High })

    expect(child.identity).toEqual({ id: 'anthropic', modelId: CLAUDE.modelId })
    expect(child.traits?.().contextWindow).toBe(200_000)
    expect(await askModel(child)).toBe('two')
    expect(fixture.adapters.anthropic.built[0]?.effortAt()).toBe(EEffort.Medium)
    expect(fixture.adapters.anthropic.built).toHaveLength(1)
    expect(fixture.parent.choice().ref).toEqual(GPT)

    const openAiStreams = fixture.adapters.openai.built[0]?.model.doStreamCalls.length ?? 0
    await fixture.parent.model.doStream({ prompt: [] })
    expect(fixture.adapters.openai.built[0]?.model.doStreamCalls.length).toBe(openAiStreams + 1)
  })

  it('a new child gets a fresh selection instead of the frozen one', async () => {
    const fixture = await childModelFixture()
    const first = await fixture.spawn()

    fixture.parent.select({ ref: GPT, effort: EEffort.Medium })
    const other = await fixture.newThread()
    const second = await fixture.spawn({ threadId: other })

    expect(first.identity).toEqual({ id: 'anthropic', modelId: CLAUDE.modelId })
    expect(second.identity).toEqual({ id: 'openai', modelId: GPT.modelId })
  })

  it('a type pin outranks the global pin, which outranks the parent', async () => {
    const fixture = await childModelFixture({ settings: { 'agents.subagentModel': keyOf(GPT) } })

    const global = await fixture.spawn({ threadId: await fixture.newThread() })
    expect(global.identity).toEqual({ id: 'openai', modelId: GPT.modelId })

    pinType(fixture, { type: 'explore', ref: CLAUDE })
    const typed = await fixture.spawn({
      agentType: childType({ name: 'explore', model: keyOf(GPT) }),
      threadId: await fixture.newThread(),
    })
    expect(typed.identity).toEqual({ id: 'anthropic', modelId: CLAUDE.modelId })
  })

  it('a pinned model keeps the effort frozen at spawn no matter where the parent effort moves', async () => {
    const fixture = await childModelFixture()
    pinSubagent(fixture, GPT)
    const pinned = await fixture.spawn()

    expect(fixture.adapters.openai.built[0]?.effortAt()).toBe(EEffort.Medium)

    fixture.parent.select({ ref: CLAUDE, effort: EEffort.High })
    expect(await askModel(pinned)).toBe('one')
    expect(fixture.adapters.openai.built[0]?.effortAt()).toBe(EEffort.Medium)

    fixture.parent.select({ ref: GPT, effort: EEffort.Low })
    expect(await askModel(pinned)).toBe('two')
    expect(fixture.adapters.openai.built[0]?.effortAt()).toBe(EEffort.Medium)
  })

  it('a settings change reaches only the next child, not one already running', async () => {
    const fixture = await childModelFixture()
    const before = await fixture.spawn()

    pinSubagent(fixture, GPT)
    expect(await askModel(before)).toBe('one')

    const after = await fixture.spawn({ threadId: await fixture.newThread() })

    expect(before.identity).toEqual({ id: 'anthropic', modelId: CLAUDE.modelId })
    expect(after.identity).toEqual({ id: 'openai', modelId: GPT.modelId })
  })

  it('a fresh source over the same thread keeps the saved choice', async () => {
    const fixture = await childModelFixture()
    await fixture.spawn()

    fixture.parent.select({ ref: GPT, effort: EEffort.High })
    const resumed = await fixture.respawn()({ agentType: childType(), threadId: fixture.threadId })

    expect(resumed.identity).toEqual({ id: 'anthropic', modelId: CLAUDE.modelId })
    expect(await askModel(resumed)).toBe('one')
    expect(fixture.adapters.anthropic.built.at(-1)?.effortAt()).toBe(EEffort.Medium)
  })

  it('the saved choice is persisted before the first request', async () => {
    const fixture = await childModelFixture({ parentEffort: EEffort.High })
    await fixture.spawn()

    expect(await fixture.savedModel(fixture.threadId)).toEqual({ ref: keyOf(CLAUDE), effort: EEffort.High })
  })

  it('a thread already carrying a model streams that model on the first runner build', async () => {
    const fixture = await childModelFixture()
    const threadId = await fixture.newThread({
      spawner: fixture.threadId,
      model: { ref: keyOf(GPT), effort: 'low' },
    })

    const child = await fixture.spawn({ threadId })

    expect(child.identity).toEqual({ id: 'openai', modelId: GPT.modelId })
    expect(await askModel(child)).toBe('one')
    expect(fixture.adapters.openai.built[0]?.effortAt()).toBe(EEffort.Low)
    expect(await fixture.savedModel(threadId)).toEqual({ ref: keyOf(GPT), effort: 'low' })
  })

  it('throws rather than falling back when the saved model is no longer buildable', async () => {
    const fixture = await childModelFixture()
    await fixture.spawn()

    const unreachable: ModelCatalogue = { ...fixture.models, cardFor: () => undefined }
    const source = childModelSource({
      models: unreachable,
      model: fixture.parent,
      hooks: () => new HookChain({}),
      settings: fixture.settings,
      threads: fixture.threads,
    })

    await expect(source({ agentType: childType(), threadId: fixture.threadId })).rejects.toThrow(
      'no provider adapter can answer for',
    )
  })

  it('concurrent legacy initialization uses the pair that actually persisted', async () => {
    const fixture = await childModelFixture()
    const threadId = await fixture.newThread({ spawner: fixture.threadId })
    const secondParent = selectableModel({
      catalogue: fixture.models,
      initial: { ref: GPT, effort: EEffort.High },
    })
    const secondSource = childModelSource({
      models: fixture.models,
      model: secondParent,
      threads: fixture.threads,
      settings: fixture.settings,
      hooks: () => new HookChain({}),
    })
    const [first, second] = await Promise.all([
      fixture.spawn({ threadId }),
      secondSource({ threadId, agentType: childType() }),
    ])
    expect(first.identity).toEqual(second.identity)
    const saved = await fixture.savedModel(threadId)
    expect(saved?.ref).toBe(`${first.identity.id}/${first.identity.modelId}`)
    const builds = fixture.adapters[first.identity.id === 'anthropic' ? 'anthropic' : 'openai'].built
    expect(builds).toHaveLength(2)
    expect(saved?.effort).toBe(builds[0]?.effortAt())
    expect(builds[0]?.effortAt()).toBe(builds[1]?.effortAt())
  })

  it('throws when the thread is unknown', async () => {
    const fixture = await childModelFixture()

    await expect(
      fixture.respawn()({ agentType: childType(), threadId: toThreadId('missing') }),
    ).rejects.toThrow('no child thread named missing')
  })
})

describe('childModelSelection', () => {
  it('snapshots the parent choice before the parent moves while async reads are in flight', async () => {
    const fixture = await childModelFixture()
    const select = fixture.selection()

    const inFlight = select({ agentType: childType(), spawnedBy: fixture.threadId })
    fixture.parent.select({ ref: GPT, effort: EEffort.High })
    const settled = await inFlight

    expect(settled).toEqual({ ref: keyOf(CLAUDE), effort: EEffort.Medium })
  })

  it("a teammate's saved choice passes to its new subagent", async () => {
    const fixture = await childModelFixture()
    const teammate = await fixture.newThread({
      spawner: fixture.threadId,
      model: { ref: keyOf(GPT), effort: 'high' },
    })

    const inherited = await fixture.selection()({ agentType: childType(), spawnedBy: teammate })

    expect(inherited).toEqual({ ref: keyOf(GPT), effort: 'high' })
  })

  it('a saved choice stays put when the supervisor persists it before the runner is built', async () => {
    const fixture = await childModelFixture()
    const select = fixture.selection()

    const chosen = await select({ agentType: childType(), spawnedBy: fixture.threadId })
    fixture.parent.select({ ref: GPT, effort: EEffort.High })

    const threadId = await fixture.newThread({ spawner: fixture.threadId, model: chosen })
    const child = await fixture.spawn({ threadId })

    expect(child.identity).toEqual({ id: 'anthropic', modelId: CLAUDE.modelId })
    expect(await askModel(child)).toBe('one')
    expect(await fixture.savedModel(threadId)).toEqual(chosen)
  })

  describe('a child whose own credential is dead', () => {
    const deadKey = new APICallError({
      message: 'the provider rejected the credential',
      url: 'https://api.openai.com/v1/responses',
      requestBodyValues: {},
      statusCode: 401,
    })

    it('falls back to the session model and answers from it', async () => {
      const fixture = await childModelFixture({
        openaiSteps: [{ error: deadKey }],
        settings: { 'agents.subagentModel': keyOf(GPT) },
      })
      const child = await fixture.spawn()

      expect(child.identity).toEqual({ id: 'openai', modelId: GPT.modelId })
      expect(await askModel(child)).toBe('one')
      expect(child.identity).toEqual({ id: 'anthropic', modelId: CLAUDE.modelId })
    })

    it('has nowhere to fall when the child already runs the session model', async () => {
      const fixture = await childModelFixture({
        anthropicSteps: [{ error: deadKey }],
      })
      const child = await fixture.spawn()

      expect(child.identity).toEqual({ id: 'anthropic', modelId: CLAUDE.modelId })
      await expect(askModel(child)).rejects.toThrow()
    })
  })
})
