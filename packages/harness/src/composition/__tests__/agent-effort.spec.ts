import { afterEach, describe, expect, it } from 'bun:test'

import { EEffort } from '@dltech/atlas-core'

import {
  askModel,
  childModelFixture,
  childType,
  cleanupHomes,
  CLAUDE,
  GPT,
  keyOf,
  pinSubagent,
  pinSubagentEffort,
  pinTypeEffort,
} from './child-model-fixtures'

afterEach(cleanupHomes)

describe('the effort a sub-agent runs on', () => {
  it('takes the effort its own type is given, with the type model', async () => {
    const fixture = await childModelFixture()
    pinTypeEffort(fixture, { type: 'explore', model: GPT, effort: EEffort.High })

    const child = await fixture.spawn({ agentType: childType({ name: 'explore' }) })

    expect(child.identity).toEqual({ id: 'openai', modelId: GPT.modelId })
    expect(fixture.adapters.openai.built[0]?.effortAt()).toBe(EEffort.High)
  })

  it('follows the parent effort when the type inherits its model, ignoring its own row', async () => {
    const fixture = await childModelFixture({ settings: { 'agents.subagentEffort': 'low' } })
    pinTypeEffort(fixture, { type: 'explore', effort: EEffort.High })

    await fixture.spawn({ agentType: childType({ name: 'explore' }) })

    expect(fixture.adapters.anthropic.built[0]?.effortAt()).toBe(EEffort.Medium)
  })

  it('runs a type with no model of its own at the sub-agent model effort', async () => {
    const fixture = await childModelFixture()
    pinSubagent(fixture, GPT)
    pinSubagentEffort(fixture, EEffort.High)

    await fixture.spawn()

    expect(fixture.adapters.openai.built[0]?.effortAt()).toBe(EEffort.High)
  })

  it('inherits the spawner effort when both rows are left on inherit', async () => {
    const fixture = await childModelFixture({ parentEffort: EEffort.High })
    pinSubagentEffort(fixture, '')

    await fixture.spawn()

    expect(fixture.adapters.anthropic.built[0]?.effortAt()).toBe(EEffort.High)
  })

  it('inherits the spawner fast mode alongside its effort', async () => {
    const fixture = await childModelFixture({ parentEffort: EEffort.High, parentFast: true })
    pinSubagentEffort(fixture, '')
    const threadId = await fixture.newThread({ spawner: fixture.threadId })

    await fixture.spawn({ threadId })

    expect(fixture.adapters.anthropic.built[0]?.effortAt()).toBe(EEffort.High)
    expect(fixture.adapters.anthropic.built[0]?.fastAt()).toBe(true)
    expect((await fixture.savedModel(threadId))?.fast).toBe(true)
  })

  it('runs a builder without fast when neither it nor its spawner has it', async () => {
    const fixture = await childModelFixture()

    await fixture.spawn()

    expect(fixture.adapters.anthropic.built[0]?.fastAt()).toBe(false)
  })

  it('inherits through a nested child from the agent that spawned it', async () => {
    const fixture = await childModelFixture()
    pinSubagentEffort(fixture, '')
    const middle = await fixture.newThread({
      spawner: fixture.threadId,
      model: { ref: keyOf(CLAUDE), effort: EEffort.Low },
    })

    const inner = await fixture.newThread({
      spawner: middle,
      model: { ref: keyOf(CLAUDE), effort: EEffort.Low },
    })
    await fixture.spawn({ threadId: inner })

    expect(fixture.adapters.anthropic.built[0]?.effortAt()).toBe(EEffort.Low)
  })

  it('ignores the sub-agent effort for a teammate, which follows the main agent', async () => {
    const fixture = await childModelFixture({
      parentEffort: EEffort.Medium,
      settings: { 'agents.subagentEffort': 'high' },
    })

    await fixture.spawn({ agentType: childType({ name: 'teammate' }) })

    expect(fixture.adapters.anthropic.built[0]?.effortAt()).toBe(EEffort.Medium)
  })

  it('gives a teammate the effort its own row names, with its own model', async () => {
    const fixture = await childModelFixture({ settings: { 'agents.subagentEffort': 'high' } })
    pinTypeEffort(fixture, { type: 'teammate', model: GPT, effort: EEffort.Low })

    await fixture.spawn({ agentType: childType({ name: 'teammate' }) })

    expect(fixture.adapters.openai.built[0]?.effortAt()).toBe(EEffort.Low)
  })

  it('freezes the effort at spawn, so a later settings change reaches only the next child', async () => {
    const fixture = await childModelFixture()
    pinTypeEffort(fixture, { type: 'explore', model: GPT, effort: EEffort.High })
    const running = await fixture.spawn({ agentType: childType({ name: 'explore' }) })

    pinTypeEffort(fixture, { type: 'explore', model: GPT, effort: EEffort.Low })
    expect(await askModel(running)).toBe('one')
    expect(fixture.adapters.openai.built[0]?.effortAt()).toBe(EEffort.High)

    await fixture.spawn({
      agentType: childType({ name: 'explore' }),
      threadId: await fixture.newThread(),
    })
    expect(fixture.adapters.openai.built[1]?.effortAt()).toBe(EEffort.Low)
  })
})
