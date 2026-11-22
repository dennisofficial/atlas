import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider'
import type { SaidImage } from '@dltech/atlas-core'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'bun:test'

import { titleFor } from '../title-for'

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

const modelSaying = (name: string): MockLanguageModelV4 =>
  new MockLanguageModelV4({ doGenerate: async () => generated(JSON.stringify({ name })) })

const modelRaising = (error: unknown): MockLanguageModelV4 =>
  new MockLanguageModelV4({
    doGenerate: async () => {
      throw error
    },
  })

const userContentOf = (model: MockLanguageModelV4) =>
  model.doGenerateCalls[0]?.prompt.find((message) => message.role === 'user')?.content ?? []

const promptTextOf = (model: MockLanguageModelV4): string => {
  const part = userContentOf(model).find((content) => content.type === 'text')
  return part?.type === 'text' ? part.text : ''
}

const promptFilePartsOf = (model: MockLanguageModelV4) =>
  userContentOf(model).filter((content) => content.type === 'file')

const SCREENSHOT: SaidImage = {
  path: '/tmp/rewind-blank-pane.png',
  mediaType: 'image/png',
  data: 'aGVsbG8=',
  width: 800,
  height: 600,
}

describe('titleFor', () => {
  it('names a session from the opening message', async () => {
    const model = modelSaying('Refresh token rotation')

    expect(await titleFor({ model: () => model, text: 'the refresh token never rotates' })).toBe(
      'Refresh token rotation',
    )
  })

  it('asks nothing of the model when there is nothing to name', async () => {
    const model = modelSaying('Refresh token rotation')

    expect(await titleFor({ model: () => model, text: '   ' })).toBeNull()
    expect(model.doGenerateCalls).toHaveLength(0)
  })

  it('sends the whole opening as structured output with no output cap', async () => {
    const model = modelSaying('Long paste')
    await titleFor({ model: () => model, text: 'x'.repeat(9000) })

    expect(promptTextOf(model).length).toBe(9000)
    expect(model.doGenerateCalls[0]?.maxOutputTokens).toBeUndefined()
    expect(model.doGenerateCalls[0]?.responseFormat?.type).toBe('json')
  })

  it('carries the abort signal so a name cannot outlive the session', async () => {
    const model = modelSaying('Refresh token rotation')
    const controller = new AbortController()
    await titleFor({ model: () => model, text: 'rotate the token', signal: controller.signal })

    expect(model.doGenerateCalls[0]?.abortSignal).toBe(controller.signal)
  })

  it('sanitizes the name the model gives', async () => {
    const model = modelSaying('"Refresh token rotation."')

    expect(await titleFor({ model: () => model, text: 'rotate' })).toBe('Refresh token rotation')
  })

  it('reports why it could not name and answers null', async () => {
    const raised = new Error('This request would exceed your account monthly spend limit')
    const faults: unknown[] = []

    expect(
      await titleFor({
        model: () => modelRaising(raised),
        text: 'rotate the token',
        onFault: (fault) => faults.push(fault),
      }),
    ).toBeNull()
    expect(faults).toEqual([raised])
  })

  it('reports a model that cannot be built', async () => {
    const faults: unknown[] = []

    await titleFor({
      model: () => {
        throw new Error('no anthropic account')
      },
      text: 'rotate the token',
      onFault: (fault) => faults.push(String(fault)),
    })

    expect(faults).toEqual(['Error: no anthropic account'])
  })

  it('asks the fallback model when the primary fails', async () => {
    const fallback = modelSaying('Refresh token rotation')

    expect(
      await titleFor({
        model: () => modelRaising(new Error('quick model refused')),
        fallback: () => fallback,
        text: 'the refresh token never rotates',
      }),
    ).toBe('Refresh token rotation')
    expect(fallback.doGenerateCalls).toHaveLength(1)
  })

  it('reports the fallback fault when both models fail', async () => {
    const faults: unknown[] = []

    await titleFor({
      model: () => modelRaising(new Error('primary refused')),
      fallback: () => modelRaising(new Error('fallback refused')),
      text: 'rotate the token',
      onFault: (fault) => faults.push(String(fault)),
    })

    expect(faults).toEqual(['Error: fallback refused'])
  })

  it('never asks the fallback when the primary names the session', async () => {
    const fallback = modelSaying('Fallback name')

    expect(
      await titleFor({
        model: () => modelSaying('Primary name'),
        fallback: () => fallback,
        text: 'rotate the token',
      }),
    ).toBe('Primary name')
    expect(fallback.doGenerateCalls).toHaveLength(0)
  })

  it('never asks the fallback once the signal has aborted', async () => {
    const fallback = modelSaying('Fallback name')
    const controller = new AbortController()
    controller.abort()

    await titleFor({
      model: () => modelRaising(new Error('aborted')),
      fallback: () => fallback,
      text: 'rotate the token',
      signal: controller.signal,
    })

    expect(fallback.doGenerateCalls).toHaveLength(0)
  })

  it('shows a picture attached to the opening message', async () => {
    const model = modelSaying('Rewind pane blanks out')

    expect(
      await titleFor({ model: () => model, text: 'can we fix this bug', images: [SCREENSHOT] }),
    ).toBe('Rewind pane blanks out')
    expect(promptFilePartsOf(model)).toHaveLength(1)
    expect(promptTextOf(model)).toContain('can we fix this bug')
  })

  it('names from the text alone when the picture is too heavy to inline', async () => {
    const tooWide: SaidImage = { ...SCREENSHOT, width: 9000, height: 80 }
    const model = modelSaying('Wide panorama')

    expect(await titleFor({ model: () => model, text: 'what is this', images: [tooWide] })).toBe(
      'Wide panorama',
    )
    expect(promptFilePartsOf(model)).toHaveLength(0)
  })

  it('names a session whose opening message is only a picture', async () => {
    const model = modelSaying('Screenshot of the crash')

    expect(await titleFor({ model: () => model, text: '  ', images: [SCREENSHOT] })).toBe(
      'Screenshot of the crash',
    )
  })
})
