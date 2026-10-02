import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider'
import { stampDrafts, toEventId, toRunId, toThreadId, type Event } from '@dltech/atlas-core'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'bun:test'

import { SummaryFailure, summaryFor } from '../summariser'

const USAGE = {
  inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 4, text: 4, reasoning: 0 },
}

const generated = (text: string): LanguageModelV4GenerateResult => ({
  content: text.length === 0 ? [] : [{ type: 'text', text }],
  finishReason: { unified: 'stop', raw: undefined },
  usage: USAGE,
  warnings: [],
})

const modelSaying = (text: string): MockLanguageModelV4 =>
  new MockLanguageModelV4({ doGenerate: async () => generated(text) })

const events = (texts: readonly string[]): Event[] =>
  stampDrafts({
    drafts: texts.map((text) => ({ type: 'user-said' as const, text })),
    envelopes: texts.map((_, index) => ({
      id: toEventId(`evt-${index + 1}`),
      seq: index + 1,
      threadId: toThreadId('thread-1'),
      runId: toRunId('run-1'),
      depth: 0,
      at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    })),
  })

const promptTextOf = (model: MockLanguageModelV4): string => {
  const user = model.doGenerateCalls[0]?.prompt.find((message) => message.role === 'user')
  const part = user?.content.find((content) => content.type === 'text')
  return part?.type === 'text' ? part.text : ''
}

describe('summaryFor', () => {
  it('returns the summary the model wrote, trimmed', async () => {
    const model = modelSaying('  you were rotating the session token  ')

    const summary = await summaryFor({ model, events: events(['rotate the token']), fromSeq: 1, throughSeq: 1 })

    expect(summary).toBe('you were rotating the session token')
  })

  it('sends the whole range regardless of length, with no output cap a reasoning model can exhaust', async () => {
    const model = modelSaying('a summary')
    const range = events(
      Array.from({ length: 800 }, (_, index) => `chunk ${index} ${'a'.repeat(550)}`),
    )

    const summary = await summaryFor({
      model,
      events: range,
      fromSeq: 1,
      throughSeq: range.length,
    })

    expect(summary).toBe('a summary')
    expect(promptTextOf(model).length).toBeGreaterThan(400_000)
    expect(promptTextOf(model)).toContain('chunk 0 ')
    expect(promptTextOf(model)).toContain(`chunk ${range.length - 1} `)
    expect(model.doGenerateCalls[0]?.maxOutputTokens).toBeUndefined()
  })

  it('asks nothing of the model when the range has no transcript', async () => {
    const model = modelSaying('a summary')

    await expect(
      summaryFor({ model, events: [], fromSeq: 1, throughSeq: 1 }),
    ).resolves.toBeNull()
    expect(model.doGenerateCalls).toHaveLength(0)
  })

  it('fails as a SummaryFailure so the caller can name the cause', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('provider 500')
      },
    })

    await expect(
      summaryFor({ model, events: events(['rotate the token']), fromSeq: 1, throughSeq: 1 }),
    ).rejects.toBeInstanceOf(SummaryFailure)
  })
})
