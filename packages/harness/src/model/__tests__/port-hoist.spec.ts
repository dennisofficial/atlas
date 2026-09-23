import { describe, expect, it } from 'bun:test'
import { MockLanguageModelV4 } from 'ai/test'

import {
  EImageTier,
  toEventId,
  toRunId,
  toThreadId,
  type Assembled,
  type ModelCard,
} from '@dltech/atlas-core'

import { AiSdkModelPort } from '../ai-sdk-model-port'
import { scriptedModel } from '../testing/scripted-model'

const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const cardFor = (api: string): ModelCard => ({
  ref: { providerId: 'openrouter', modelId: 'moonshotai/kimi-k3' },
  label: 'Kimi K3',
  api,
  contextWindow: 1_048_576,
  imageTier: EImageTier.Standard,
})

const origin = { eventId: toEventId('evt_1'), runId: toRunId('run_1'), threadId: toThreadId('thread_1'), seq: 1 }

const assembledWithToolImage: Assembled = {
  system: [],
  messages: [
    {
      origin,
      message: {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'read_1',
            toolName: 'read',
            output: {
              type: 'content',
              value: [
                { type: 'text', text: '/tmp/shot.png — image/png.' },
                { type: 'image', data: PIXEL, mediaType: 'image/png', source: '/tmp/shot.png' },
              ],
            },
          },
        ],
      },
    },
  ],
}

async function promptSeenBy(model: MockLanguageModelV4, card: ModelCard) {
  const port = new AiSdkModelPort({ model, card })
  await port.step({
    assembled: assembledWithToolImage,
    tools: [],
    signal: new AbortController().signal,
  })
  return model.doStreamCalls[0]?.prompt ?? []
}

describe('a tool-result image bound for a completions-API model', () => {
  it('travels as a real image in a user message, not as base64 inside the tool message', async () => {
    const model = scriptedModel({ script: [{ text: 'ok' }] })

    const prompt = await promptSeenBy(model, cardFor('openai-completions'))

    const roles = prompt.map((message) => message.role)
    expect(roles).toEqual(['tool', 'user'])

    const tool = prompt[0]
    if (tool?.role !== 'tool') throw new Error('expected the tool message first')
    expect(JSON.stringify(tool.content)).not.toContain(PIXEL.slice(0, 40))

    const anchor = prompt[1]
    if (anchor?.role !== 'user' || typeof anchor.content === 'string') {
      throw new Error('expected the hoisted image in a user message')
    }
    expect(anchor.content.some((part) => part.type === 'file' && part.mediaType === 'image/png')).toBe(true)
  })

  it('stays inside the tool message for an API that carries tool images natively', async () => {
    const model = scriptedModel({ script: [{ text: 'ok' }] })

    const prompt = await promptSeenBy(model, cardFor('anthropic-messages'))

    expect(prompt.map((message) => message.role)).toEqual(['tool'])
    const tool = prompt[0]
    if (tool?.role !== 'tool') throw new Error('expected the tool message first')
    expect(JSON.stringify(tool.content)).toContain(PIXEL.slice(0, 40))
  })
})
