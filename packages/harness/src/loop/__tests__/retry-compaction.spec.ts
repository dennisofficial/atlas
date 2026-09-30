import { afterEach, describe, expect, it } from 'bun:test'
import { APICallError } from '@ai-sdk/provider'
import {
  defaultPipeline, EMPTY_PROMPT, ECompactionAnchor, EFinishReason, EImageTier,
  type Assembled, type ModelCard, type ModelPort, type RetryPolicy,
} from '@dltech/atlas-core'

import { buildHarness, ETurnStatus, LoopTurnRunner, type AtlasHarness } from '..'
import { scriptedModel } from '../../model/testing/scripted-model'
import { takeModelStepWithRetry } from '../retrying-step'
import { createTempHome, type TempHome } from './temp-home'

const opened: { harness: AtlasHarness; temp: TempHome }[] = []
afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.harness.close()
    entry.temp.discard()
  }
})

const FAIL_FAST: RetryPolicy = { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 1 }
const card: ModelCard = {
  ref: { providerId: 'anthropic', modelId: 'claude-haiku-4-5' },
  label: 'haiku-4-5', api: 'anthropic', contextWindow: 200_000, imageTier: EImageTier.Standard,
}

async function fixture() {
  const temp = createTempHome()
  const harness = await buildHarness({ home: temp.home, model: scriptedModel({ script: [{ text: 'done' }] }) })
  opened.push({ harness, temp })
  return harness
}

describe('retry and compaction preparation', () => {
  it('reassembles after a compacted preparation before issuing the next request', async () => {
    const initial: Assembled = { system: [{ text: 'before compaction' }], messages: [] }
    const refreshed: Assembled = { system: [{ text: 'after compaction' }], messages: [] }
    const requested: Assembled[] = []
    let prepares = 0
    const model: ModelPort = {
      identity: { id: 'anthropic', modelId: 'claude-test' },
      step: async ({ assembled }) => {
        requested.push(assembled)
        if (requested.length === 1) throw new APICallError({
          message: 'overloaded', url: 'https://api.anthropic.com/v1/messages', requestBodyValues: {}, statusCode: 529,
        })
        return { parts: [{ type: 'text', text: 'done' }], toolCalls: [], finishReason: EFinishReason.Stop }
      },
    }
    const outcome = await takeModelStepWithRetry({
      model, tools: [], onChunk: undefined, assembled: initial, signal: new AbortController().signal,
      retry: { policy: FAIL_FAST, sleep: async () => undefined, jitter: () => 1 },
      prepare: async () => {
        prepares += 1
        return prepares === 1 ? { ok: true, compacted: true } : { ok: true, assembled: refreshed, tokens: 0 }
      },
    })
    expect(outcome.ok).toBe(true)
    expect(prepares).toBe(2)
    expect(requested).toEqual([initial, refreshed])
  })

  it('keeps mid-turn compaction off below the hard limit despite the turn-end threshold', async () => {
    const harness = await fixture()
    const thread = await harness.threads.create({})
    let compacted = false
    let asked = 0
    const runner = new LoopTurnRunner({
      log: harness.log, ids: harness.ids,
      model: {
        identity: harness.model.identity,
        step: (args) => harness.model.step(args),
        traits: () => ({ contextWindow: 1_000 }),
      },
      assembly: defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: '/w' }),
      countTokens: () => compacted ? 100 : 950,
      autoCompactAtPercent: () => 90,
      compact: async () => { asked += 1; compacted = true; return true },
    })
    const outcome = await runner.say({ threadId: thread.id, text: 'work' })
    expect(asked).toBe(0)
    expect(outcome.status).toBe(ETurnStatus.Completed)
  })

  it('compacts when the hard window is reached and completes after rewriting the log', async () => {
    const temp = createTempHome()
    let asked = 0
    const harness = await buildHarness({
      home: temp.home, model: scriptedModel({ script: [{ text: 'done' }] }),
      identity: { id: 'anthropic', modelId: 'claude-haiku-4-5' }, card,
      autoCompactAtPercent: () => 90,
      compact: async ({ threadId }) => {
        asked += 1
        await harness.threads.compact({
          threadId, anchor: ECompactionAnchor.Prefix, fromSeq: 1, throughSeq: 2,
          summary: 'compacted at the window limit',
        })
        return true
      },
    })
    opened.push({ harness, temp })
    const thread = await harness.threads.create({})
    await harness.log.append({ threadId: thread.id, runId: harness.ids.nextRunId(), drafts: [
      { type: 'user-said', text: 'x'.repeat(800_000) },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'read it' }] },
    ] })
    const outcome = await harness.runner.say({ threadId: thread.id, text: 'summarise' })
    expect(asked).toBe(1)
    expect(outcome.status).toBe(ETurnStatus.Completed)
  })

  it('does not compact at overflow when the threshold is off', async () => {
    const temp = createTempHome()
    let asked = 0
    const harness = await buildHarness({
      home: temp.home, model: scriptedModel({ script: [{ text: 'done' }] }),
      identity: { id: 'anthropic', modelId: 'claude-haiku-4-5' }, card,
      autoCompactAtPercent: () => 0, compact: async () => { asked += 1; return true },
    })
    opened.push({ harness, temp })
    const thread = await harness.threads.create({})
    const outcome = await harness.runner.say({ threadId: thread.id, text: 'x'.repeat(800_000) })
    expect(asked).toBe(0)
    expect(outcome.status).toBe(ETurnStatus.Failed)
  })

  it('releases an aborted preparation so another turn can drain', async () => {
    const harness = await fixture()
    const thread = await harness.threads.create({})
    const controller = new AbortController()
    let drains = 0
    let released = 0
    const runner = new LoopTurnRunner({
      log: harness.log, model: harness.model, ids: harness.ids,
      assembly: defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: '/w' }),
      drainPending: async () => {
        drains += 1
        if (drains === 1) {
          controller.abort()
          return { drafts: [], wakesTurn: false, release: () => { released += 1 } }
        }
        return { drafts: [], wakesTurn: false }
      },
    })
    const first = await runner.runTurn({ threadId: thread.id, signal: controller.signal })
    expect(first.status).toBe(ETurnStatus.Interrupted)
    expect(released).toBe(1)
    expect(drains).toBe(1)
    const second = await runner.runTurn({ threadId: thread.id })
    expect(second.status).toBe(ETurnStatus.Idle)
    expect(drains).toBe(2)
  })
})
