import { afterEach, describe, expect, it } from 'bun:test'

import { pendingCalls, type ThreadId } from '@dltech/atlas-core'

import { buildHarness, ETurnStatus, type AtlasHarness } from '..'
import { PauseSignal } from '../pause-signal'
import { scriptedModel } from '../../model/testing/scripted-model'
import { createTempHome, type TempHome } from './temp-home'

const opened: { harness: AtlasHarness; temp: TempHome }[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.harness.close()
    entry.temp.discard()
  }
})

async function openWith(script: Parameters<typeof scriptedModel>[0]['script']): Promise<{
  harness: AtlasHarness
  threadId: ThreadId
}> {
  const temp = createTempHome()
  const harness = await buildHarness({ home: temp.home, model: scriptedModel({ script }) })
  opened.push({ harness, temp })
  const thread = await harness.threads.create({})
  return { harness, threadId: thread.id }
}

const eventTypes = async (harness: AtlasHarness, threadId: ThreadId) =>
  (await harness.log.read({ threadId })).map((event) => event.type)

describe('pausing a turn for relocation', () => {
  it('halts at the seam before the model is asked again and answers relocation-paused', async () => {
    const { harness, threadId } = await openWith([{ text: 'still working' }])
    const pause = new PauseSignal()
    pause.pause()

    const outcome = await harness.runner.say({ threadId, text: 'what changed?', pause })

    expect(outcome.status).toBe(ETurnStatus.RelocationPaused)
  })

  it('writes nothing but what was already durable — no interrupted drafts, no assistant turn', async () => {
    const { harness, threadId } = await openWith([{ text: 'still working' }])
    const pause = new PauseSignal()
    pause.pause()

    await harness.runner.say({ threadId, text: 'what changed?', pause })

    expect(await eventTypes(harness, threadId)).toEqual(['user-said'])
  })

  it('leaves no tool call pending that a far side would try to settle', async () => {
    const { harness, threadId } = await openWith([{ text: 'still working' }])
    const pause = new PauseSignal()
    pause.pause()

    await harness.runner.say({ threadId, text: 'what changed?', pause })

    expect(pendingCalls(await harness.log.read({ threadId }))).toEqual([])
  })

  it('resumes from the log on the far side and completes without re-asking what already ran', async () => {
    const { harness, threadId } = await openWith([{ text: 'still working' }])
    const pause = new PauseSignal()
    pause.pause()

    await harness.runner.say({ threadId, text: 'what changed?', pause })

    const outcome = await harness.runner.resume({ threadId })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(await eventTypes(harness, threadId)).toEqual(['user-said', 'assistant-said'])
  })

  it('lets a paused mid-turn loop keep its committed steps and halt before the next', async () => {
    const { harness, threadId } = await openWith([{ text: 'still working' }])
    await harness.runner.say({ threadId, text: 'what changed?' })
    const pause = new PauseSignal()
    pause.pause()

    const outcome = await harness.runner.runTurn({ threadId, pause })

    expect(outcome.status).toBe(ETurnStatus.RelocationPaused)
    expect(await eventTypes(harness, threadId)).toEqual(['user-said', 'assistant-said'])
  })

  it('is not an abort: the same turn ignores a pause signal left unpaused', async () => {
    const { harness, threadId } = await openWith([{ text: 'all done' }])

    const outcome = await harness.runner.say({ threadId, text: 'what changed?', pause: new PauseSignal() })

    expect(outcome.status).toBe(ETurnStatus.Completed)
  })
})
