import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider'
import { DIAGRAM_REPAIR_EMPTY, DIAGRAM_REPAIR_UNCHANGED, EDiagramRepair } from '@dltech/atlas-core'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'bun:test'

import { repairDiagramText } from '../repair-text'

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

const isTextPart = (part: unknown): part is { type: 'text'; text: string } =>
  typeof part === 'object' &&
  part !== null &&
  Reflect.get(part, 'type') === 'text' &&
  typeof Reflect.get(part, 'text') === 'string'

const promptOf = (model: MockLanguageModelV4): string => {
  const content: unknown = model.doGenerateCalls[0]?.prompt.find(
    (message) => message.role === 'user',
  )?.content
  return Array.isArray(content)
    ? content
        .filter(isTextPart)
        .map((part) => part.text)
        .join('\n')
    : ''
}

const SOURCE = 'graph TD\n  A[one; two] --> B[done]'
const ERROR = 'Parse error on line 2: got SEMICOLON'

describe('repairDiagramText', () => {
  it('takes a repaired diagram out of the reply fence', async () => {
    const model = modelSaying('```mermaid\ngraph TD\n  A["one; two"] --> B[done]\n```')

    expect(await repairDiagramText({ model: () => model, source: SOURCE, error: ERROR })).toEqual({
      kind: EDiagramRepair.Repaired,
      repaired: 'graph TD\n  A["one; two"] --> B[done]',
    })
  })

  it('fails when the model only repeats the diagram', async () => {
    const model = modelSaying(SOURCE)

    expect(await repairDiagramText({ model: () => model, source: SOURCE, error: ERROR })).toEqual({
      kind: EDiagramRepair.Failed,
      reason: DIAGRAM_REPAIR_UNCHANGED,
    })
  })

  it('fails when the model answers nothing', async () => {
    const model = modelSaying('   ')

    expect(await repairDiagramText({ model: () => model, source: SOURCE, error: ERROR })).toEqual({
      kind: EDiagramRepair.Failed,
      reason: DIAGRAM_REPAIR_EMPTY,
    })
  })

  it('asks with the error, the surrounding text and the source', async () => {
    const model = modelSaying('graph TD\n  A[one] --> B[done]')
    await repairDiagramText({
      model: () => model,
      source: SOURCE,
      error: ERROR,
      context: 'the flow we discussed',
    })

    const prompt = promptOf(model)
    expect(prompt).toContain(ERROR)
    expect(prompt).toContain('the flow we discussed')
    expect(prompt).toContain(SOURCE)
  })

  it('carries the abort signal and asks the model once', async () => {
    const model = modelSaying('graph TD\n  A[one] --> B[done]')
    const controller = new AbortController()

    await repairDiagramText({
      model: () => model,
      source: SOURCE,
      error: ERROR,
      signal: controller.signal,
    })

    expect(model.doGenerateCalls[0]?.abortSignal).toBe(controller.signal)
    expect(model.doGenerateCalls).toHaveLength(1)
  })

  it('propagates a provider failure to the caller without a retry', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('no anthropic account')
      },
    })

    expect(repairDiagramText({ model: () => model, source: SOURCE, error: ERROR })).rejects.toThrow(
      'no anthropic account',
    )
    expect(model.doGenerateCalls).toHaveLength(1)
  })
})
