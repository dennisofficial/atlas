import { afterEach, describe, expect, it } from 'bun:test'

import { EEffort } from '@dltech/atlas-core'

import {
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

const teammate = childType({ name: 'teammate' })

describe('the model a teammate starts on', () => {
  it('follows the main agent while a sub-agent role model is set', async () => {
    const fixture = await childModelFixture({
      parentEffort: EEffort.High,
      settings: { 'agents.subagentModel': keyOf(GPT) },
    })

    const chosen = await fixture.selection()({ agentType: teammate, spawnedBy: fixture.threadId })

    expect(chosen).toEqual({ ref: keyOf(CLAUDE), effort: EEffort.High })
  })

  it('still sends a plain sub-agent to the sub-agent role model', async () => {
    const fixture = await childModelFixture({ settings: { 'agents.subagentModel': keyOf(GPT) } })

    const chosen = await fixture.selection()({ agentType: childType(), spawnedBy: fixture.threadId })

    expect(chosen.ref).toBe(keyOf(GPT))
  })

  it('takes the main agent model as it is when the teammate is spawned, not at launch', async () => {
    const fixture = await childModelFixture({ settings: { 'agents.subagentModel': keyOf(GPT) } })

    fixture.parent.select({ ref: GPT, effort: EEffort.Low })
    const chosen = await fixture.selection()({ agentType: teammate, spawnedBy: fixture.threadId })

    expect(chosen).toEqual({ ref: keyOf(GPT), effort: EEffort.Low })
  })

  it('runs on the main agent provider with the main agent effort', async () => {
    const fixture = await childModelFixture({
      parentEffort: EEffort.High,
      settings: { 'agents.subagentModel': keyOf(GPT) },
    })

    const port = await fixture.spawn({ agentType: teammate })

    expect(port.identity).toEqual({ id: 'anthropic', modelId: CLAUDE.modelId })
    expect(fixture.adapters.anthropic.built[0]?.effortAt()).toBe(EEffort.High)
    expect(fixture.adapters.openai.built).toHaveLength(0)
  })
})

describe('a model a teammate is explicitly given', () => {
  it('comes from its own agents.type.teammate setting, with the main agent effort', async () => {
    const fixture = await childModelFixture({ parentEffort: EEffort.Low })
    pinType(fixture, { type: 'teammate', ref: GPT })

    const chosen = await fixture.selection()({ agentType: teammate, spawnedBy: fixture.threadId })

    expect(chosen).toEqual({ ref: keyOf(GPT), effort: EEffort.Low })
  })

  it('outranks the sub-agent role model', async () => {
    const fixture = await childModelFixture({ settings: { 'agents.subagentModel': keyOf(CLAUDE) } })
    pinType(fixture, { type: 'teammate', ref: GPT })

    const port = await fixture.spawn({ agentType: teammate })

    expect(port.identity).toEqual({ id: 'openai', modelId: GPT.modelId })
  })

  it('can come from the definition when no setting names one', async () => {
    const fixture = await childModelFixture({ settings: { 'agents.subagentModel': keyOf(CLAUDE) } })

    const chosen = await fixture.selection()({
      agentType: childType({ name: 'teammate', model: keyOf(GPT) }),
      spawnedBy: fixture.threadId,
    })

    expect(chosen.ref).toBe(keyOf(GPT))
  })

  it('is saved with the thread and survives later settings and main agent changes', async () => {
    const fixture = await childModelFixture()
    pinType(fixture, { type: 'teammate', ref: GPT })
    const threadId = await fixture.newThread({ spawner: fixture.threadId })
    await fixture.spawn({ agentType: teammate, threadId })

    pinType(fixture, { type: 'teammate', ref: CLAUDE })
    pinSubagent(fixture, CLAUDE)
    fixture.parent.select({ ref: CLAUDE, effort: EEffort.High })
    const resumed = await fixture.respawn()({ agentType: teammate, threadId })

    expect(await fixture.savedModel(threadId)).toEqual({ ref: keyOf(GPT), effort: EEffort.Medium })
    expect(resumed.identity).toEqual({ id: 'openai', modelId: GPT.modelId })
  })

  it('leaves an inherited teammate model saved the same way', async () => {
    const fixture = await childModelFixture({ settings: { 'agents.subagentModel': keyOf(GPT) } })
    const threadId = await fixture.newThread({ spawner: fixture.threadId })
    await fixture.spawn({ agentType: teammate, threadId })

    pinSubagent(fixture, CLAUDE)
    fixture.parent.select({ ref: GPT, effort: EEffort.High })
    const resumed = await fixture.respawn()({ agentType: teammate, threadId })

    expect(await fixture.savedModel(threadId)).toEqual({ ref: keyOf(CLAUDE), effort: EEffort.Medium })
    expect(resumed.identity).toEqual({ id: 'anthropic', modelId: CLAUDE.modelId })
  })
})
