import { afterEach, describe, expect, it } from 'bun:test'
import {
  defaultPipeline,
  EMPTY_PROMPT,
  EPrEventKind,
  toThreadId,
  type EventDraft,
} from '@dltech/atlas-core'

import { buildHarness, ETurnStatus, LoopTurnRunner, type AtlasHarness } from '../../loop'
import { createTempHome, type TempHome } from '../../loop/__tests__/temp-home'
import { scriptedModel } from '../../model/testing/scripted-model'
import { SubscriptionRegistry } from '../registry'
import { EOccurrenceUrgency } from '../provider'
import { FakeProvider } from './registry-fixture'

const opened: { harness: AtlasHarness; temp: TempHome }[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.harness.close()
    entry.temp.discard()
  }
})

const merged: EventDraft = {
  type: 'pr-event',
  repo: 'github.com/compai/app',
  prNumber: 42,
  kind: EPrEventKind.State,
  url: 'https://github.com/compai/app/pull/42',
  eventId: 'evt-merged',
}

describe('a turn woken only by a pr-event', () => {
  it('reaches the model and answers, and a later reload replays nothing', async () => {
    const temp = createTempHome()
    const model = scriptedModel({ script: [{ text: 'the pull request merged' }] })
    const harness = await buildHarness({ home: temp.home, model })
    opened.push({ harness, temp })
    const thread = await harness.threads.create({})
    const fake = new FakeProvider()
    let next = 0
    const registry = new SubscriptionRegistry({
      log: harness.log,
      ids: harness.ids,
      owners: { ownerOf: async ({ threadId }) => threadId },
      providers: [fake.provider],
      now: () => Date.now(),
      schedule: () => () => undefined,
      warn: () => undefined,
      newId: () => `sub-${++next}`,
    })
    await registry.subscribe({
      threadId: thread.id,
      provider: 'fake.pr',
      input: 'a/b#1',
      projectDirectory: '/w',
      by: 'agent' as never,
      expiresAt: undefined,
    })
    fake.emit({
      id: 'sub-1',
      occurrence: { key: 'merged', urgency: EOccurrenceUrgency.Now, ends: true, draft: merged },
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    const runner = new LoopTurnRunner({
      log: harness.log,
      ids: harness.ids,
      model: harness.model,
      assembly: defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: '/w' }),
      drainPending: async ({ threadId }) => registry.intakeSource.prepare({ threadId }),
    })
    const outcome = await runner.runTurn({ threadId: thread.id })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(model.doStreamCalls).toHaveLength(1)
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain('PR #42')

    await registry.reload({ threadId: toThreadId(thread.id) })
    expect(registry.intakeSource.threadsAwaitingInput()).toEqual([])
    registry.dispose()
  })
})
