import { afterEach, describe, expect, it } from 'bun:test'

import { EFinishReason } from '@dltech/atlas-core'

import { buildHarness, ETurnStatus, type AtlasHarness } from '..'
import { scriptedModel, type ScriptedStep } from '../../model/testing/scripted-model'
import { fixturePrompt } from './fixture-prompt'
import { createTempHome, type TempHome } from './temp-home'

const opened: { harness: AtlasHarness; temp: TempHome }[] = []

async function open(script: readonly ScriptedStep[]) {
  const temp = createTempHome()
  const model = scriptedModel({ script })
  const harness = await buildHarness({ home: temp.home, model, prompt: fixturePrompt() })
  opened.push({ harness, temp })
  return { harness, model }
}

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.harness.close()
    entry.temp.discard()
  }
})

describe('a model step that comes back empty', () => {
  it('silently retries the identical request once and completes without nudging when it answers', async () => {
    const { harness, model } = await open([{}, { text: 'here is what I found' }])
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'what changed?' })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(model.doStreamCalls).toHaveLength(2)
    const events = await harness.log.read({ threadId: thread.id })
    expect(events.map((event) => event.type)).toEqual(['user-said', 'assistant-said'])
  })

  it('nudges only after the raw retry also comes back empty, then completes', async () => {
    const { harness, model } = await open([{}, {}, { text: 'here is what I found' }])
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'what changed?' })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(model.doStreamCalls).toHaveLength(3)
    const events = await harness.log.read({ threadId: thread.id })
    expect(events.map((event) => event.type)).toEqual(['user-said', 'nudge', 'assistant-said'])
  })

  it('fails the turn naming the empty replies when the model stays silent after the retry and nudge', async () => {
    const { harness, model } = await open([{}, {}, {}, { text: 'unreachable' }])
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'what changed?' })

    expect(outcome.status).toBe(ETurnStatus.Failed)
    expect(outcome.status === ETurnStatus.Failed ? outcome.message : '').toMatch(/empty reply/)
    expect(model.doStreamCalls).toHaveLength(3)
    const events = await harness.log.read({ threadId: thread.id })
    expect(events.map((event) => event.type)).toEqual(['user-said', 'nudge'])
  })

  it('treats whitespace-only text as silence rather than as an answer', async () => {
    const { harness } = await open([{ text: '  \n ' }, { text: 'the real answer' }])
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'what changed?' })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    const events = await harness.log.read({ threadId: thread.id })
    expect(events.map((event) => event.type)).toEqual(['user-said', 'assistant-said'])
  })

  it('does not retry a decided empty answer, only a dropped one', async () => {
    const { harness, model } = await open([
      { finishReason: EFinishReason.Length },
      { text: 'the real answer' },
    ])
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'what changed?' })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(model.doStreamCalls).toHaveLength(2)
    const events = await harness.log.read({ threadId: thread.id })
    expect(events.map((event) => event.type)).toEqual(['user-said', 'nudge', 'assistant-said'])
  })

  it('does not retry past a content-filter finish', async () => {
    const { harness, model } = await open([
      { finishReason: EFinishReason.ContentFilter },
      { text: 'unreachable' },
    ])
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'what changed?' })

    expect(outcome.status).toBe(ETurnStatus.Failed)
    expect(outcome.status === ETurnStatus.Failed ? outcome.message : '').toMatch(/content-filter/)
    expect(model.doStreamCalls).toHaveLength(1)
  })
})
