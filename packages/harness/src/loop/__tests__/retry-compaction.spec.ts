import { afterEach, describe, expect, it } from 'bun:test'
import { APICallError } from '@ai-sdk/provider'
import {
  defaultPipeline,
  EMPTY_PROMPT,
  EFinishReason,
  type Assembled,
  type ModelPort,
  type RetryPolicy,
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
async function fixture() {
  const temp = createTempHome()
  const harness = await buildHarness({
    home: temp.home,
    model: scriptedModel({ script: [{ text: 'done' }] }),
  })
  opened.push({ harness, temp })
  return harness
}

describe('retry and compaction preparation', () => {
  it('reassembles after a retry before issuing the next request', async () => {
    const initial: Assembled = { system: [{ text: 'before compaction' }], messages: [] }
    const refreshed: Assembled = { system: [{ text: 'after compaction' }], messages: [] }
    const requested: Assembled[] = []
    let prepares = 0
    const model: ModelPort = {
      identity: { id: 'anthropic', modelId: 'claude-test' },
      step: async ({ assembled }) => {
        requested.push(assembled)
        if (requested.length === 1)
          throw new APICallError({
            message: 'overloaded',
            url: 'https://api.anthropic.com/v1/messages',
            requestBodyValues: {},
            statusCode: 529,
          })
        return {
          parts: [{ type: 'text', text: 'done' }],
          toolCalls: [],
          finishReason: EFinishReason.Stop,
        }
      },
    }
    const outcome = await takeModelStepWithRetry({
      model,
      tools: [],
      onChunk: undefined,
      assembled: initial,
      signal: new AbortController().signal,
      retry: { policy: FAIL_FAST, sleep: async () => undefined, jitter: () => 1 },
      prepare: async () => {
        prepares += 1
        return { ok: true, assembled: refreshed, tokens: 0 }
      },
    })
    expect(outcome.ok).toBe(true)
    expect(prepares).toBe(1)
    expect(requested).toEqual([initial, refreshed])
  })

  it('releases an aborted preparation so another turn can drain', async () => {
    const harness = await fixture()
    const thread = await harness.threads.create({})
    const controller = new AbortController()
    let drains = 0
    let released = 0
    const runner = new LoopTurnRunner({
      launchDirectory: process.cwd(),
      log: harness.log,
      model: harness.model,
      ids: harness.ids,
      assembly: defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: '/w' }),
      intake: {
        prepare: async () => {
          drains += 1
          if (drains === 1) {
            controller.abort()
            return {
              drafts: [],
              wakesTurn: false,
              release: () => {
                released += 1
              },
            }
          }
          return { drafts: [], wakesTurn: false }
        },
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
