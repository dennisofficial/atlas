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

describe('a step the provider did not let finish cleanly', () => {
  it('fails the turn naming the safety filter rather than reading it as a stop', async () => {
    const { harness } = await open([{ text: 'partial answer', finishReason: EFinishReason.ContentFilter }])
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'what changed?' })

    expect(outcome.status).toBe(ETurnStatus.Failed)
    expect(outcome.status === ETurnStatus.Failed ? outcome.message : '').toMatch(/content-filter/)
    const events = await harness.log.read({ threadId: thread.id })
    expect(events.map((event) => event.type)).toEqual(['user-said', 'assistant-said'])
  })

  it('fails the turn when the provider ends the reply with an error finish', async () => {
    const { harness } = await open([{ finishReason: EFinishReason.Error }])
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'what changed?' })

    expect(outcome.status).toBe(ETurnStatus.Failed)
    expect(outcome.status === ETurnStatus.Failed ? outcome.message : '').toMatch(/finish reason "error"/)
  })

  it('names the finish reason when an empty reply also fails the nudge', async () => {
    const { harness } = await open([
      { finishReason: EFinishReason.Length },
      { finishReason: EFinishReason.Length },
    ])
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'what changed?' })

    expect(outcome.status).toBe(ETurnStatus.Failed)
    expect(outcome.status === ETurnStatus.Failed ? outcome.message : '').toMatch(/"length"/)
  })
})
