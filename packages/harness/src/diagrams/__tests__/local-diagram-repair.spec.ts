import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'bun:test'

import {
  EventLogPort,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type EventDraft,
} from '@dltech/atlas-core'

import { LocalDiagramRepair } from '../local-diagram-repair'

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
}

const generated = (text: string): LanguageModelV4GenerateResult => ({
  content: [{ type: 'text', text }],
  finishReason: { unified: 'stop', raw: undefined },
  usage: USAGE,
  warnings: [],
})

class RecordingLog extends EventLogPort {
  readonly appended: EventDraft[] = []

  async append(args: { drafts: readonly EventDraft[] }): Promise<Event[]> {
    this.appended.push(...args.drafts)
    return []
  }
  async replace(): Promise<Event[]> {
    return []
  }
  async read(): Promise<Event[]> {
    return []
  }
  async refresh(): Promise<void> {}
  async head(): Promise<number> {
    return 0
  }
  async readOwn(): Promise<Event[]> {
    return []
  }
}

const threadId = toThreadId('thr-1')
const messageId = toEventId('evt-1')
const SOURCE = 'graph TD\n  A[a;b] --> B'
const FIXED = 'graph TD\n  A["a;b"] --> B'

const repairer = (args: { model: MockLanguageModelV4 | undefined; log?: RecordingLog }) => {
  const log = args.log ?? new RecordingLog()
  const repair = new LocalDiagramRepair({
    log,
    model: () => args.model,
    modelId: () => 'claude-x',
    runId: () => toRunId('run-1'),
  })
  return { log, repair }
}

const ask = (repair: LocalDiagramRepair, signal?: AbortSignal) =>
  repair.repair({
    threadId,
    messageId,
    source: SOURCE,
    error: 'Parse error on line 2',
    ...(signal === undefined ? {} : { signal }),
  })

describe('LocalDiagramRepair', () => {
  it('appends diagram-repaired with the session model id and returns the unfenced source', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => generated('```mermaid\n' + FIXED + '\n```'),
    })
    const { log, repair } = repairer({ model })

    expect(await ask(repair)).toEqual({ kind: 'repaired', repaired: FIXED })

    expect(log.appended).toEqual([
      {
        type: 'diagram-repaired',
        messageId,
        original: SOURCE,
        repaired: FIXED,
        modelId: 'claude-x',
      },
    ])
    const prompt = model.doGenerateCalls[0]?.prompt
    expect(JSON.stringify(prompt)).toContain('Parse error on line 2')
  })

  it('fails without appending when no session model is available', async () => {
    const { log, repair } = repairer({ model: undefined })

    expect(await ask(repair)).toEqual({
      kind: 'failed',
      reason: 'the session model is unavailable',
    })
    expect(log.appended).toEqual([])
  })

  it('fails without appending when the model returns the source unchanged', async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => generated(SOURCE) })
    const { log, repair } = repairer({ model })

    expect(await ask(repair)).toMatchObject({ kind: 'failed' })
    expect(log.appended).toEqual([])
  })

  it('fails without appending when the model returns nothing', async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => generated('  ') })
    const { log, repair } = repairer({ model })

    expect(await ask(repair)).toMatchObject({ kind: 'failed' })
    expect(log.appended).toEqual([])
  })

  it('turns a model error into a failed outcome carrying its message', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('rate limited')
      },
    })
    const { log, repair } = repairer({ model })

    expect(await ask(repair)).toEqual({ kind: 'failed', reason: 'rate limited' })
    expect(log.appended).toEqual([])
  })

  it('does not retry inside the SDK', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('boom')
      },
    })
    const { repair } = repairer({ model })

    await ask(repair)

    expect(model.doGenerateCalls).toHaveLength(1)
  })
})
