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

  it('lets the type effort outrank the sub-agent effort', async () => {
    const fixture = await childModelFixture({ settings: { 'agents.subagentEffort': 'low' } })
    pinTypeEffort(fixture, { type: 'explore', effort: EEffort.High })

    await fixture.spawn({ agentType: childType({ name: 'explore' }) })

    expect(fixture.adapters.anthropic.built[0]?.effortAt()).toBe(EEffort.High)
  })

  it('applies the sub-agent effort to a type with no effort of its own', async () => {
    const fixture = await childModelFixture()
    pinSubagentEffort(fixture, EEffort.High)

    await fixture.spawn()

    expect(fixture.adapters.anthropic.built[0]?.effortAt()).toBe(EEffort.High)
  })

  it('inherits the spawner effort when both rows are left on inherit', async () => {
    const fixture = await childModelFixture({ parentEffort: EEffort.High })
    pinSubagentEffort(fixture, '')

    await fixture.spawn()

    expect(fixture.adapters.anthropic.built[0]?.effortAt()).toBe(EEffort.High)
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

  it('gives a teammate the effort its own row names', async () => {
    const fixture = await childModelFixture({ settings: { 'agents.subagentEffort': 'high' } })
    pinTypeEffort(fixture, { type: 'teammate', effort: EEffort.Low })

    await fixture.spawn({ agentType: childType({ name: 'teammate' }) })

    expect(fixture.adapters.anthropic.built[0]?.effortAt()).toBe(EEffort.Low)
  })

  it('freezes the effort at spawn, so a later settings change reaches only the next child', async () => {
    const fixture = await childModelFixture()
    pinTypeEffort(fixture, { type: 'explore', effort: EEffort.High })
    const running = await fixture.spawn({ agentType: childType({ name: 'explore' }) })

    pinTypeEffort(fixture, { type: 'explore', effort: EEffort.Low })
    expect(await askModel(running)).toBe('one')
    expect(fixture.adapters.anthropic.built[0]?.effortAt()).toBe(EEffort.High)

    await fixture.spawn({
      agentType: childType({ name: 'explore' }),
      threadId: await fixture.newThread(),
    })
    expect(fixture.adapters.anthropic.built[1]?.effortAt()).toBe(EEffort.Low)
  })
})
