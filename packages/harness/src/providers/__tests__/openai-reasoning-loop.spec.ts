import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { generateText, stepCountIs } from 'ai'

import { recordingFetch } from './recording-fetch'
import {
  TEXT_RESPONSE,
  TOOL_CALL_RESPONSE,
  apiCredentials,
  lookupTool,
  openAiModel,
} from './openai-reasoning-fixtures'

describe('openai multi-step reasoning through the real SDK', () => {
  const warnings: string[] = []
  let warnSpy: ReturnType<typeof spyOn>

  afterEach(() => {
    warnSpy?.mockRestore()
    warnings.length = 0
  })

  const watchWarnings = (): void => {
    warnSpy = spyOn(console, 'warn').mockImplementation((message?: unknown) => {
      warnings.push(String(message))
    })
  }

  it('threads a tool call and its result into the next request through the real SDK', async () => {
    watchWarnings()
    let call = 0
    const requests: Record<string, unknown>[] = []
    const model = openAiModel({
      credentials: apiCredentials(),
      fetch: Object.assign(
        async (_input: unknown, init: RequestInit | undefined) => {
          requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
          call += 1
          return new Response(call === 1 ? TOOL_CALL_RESPONSE : TEXT_RESPONSE, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    })

    const result = await generateText({
      model,
      prompt: 'what is the weather in paris?',
      tools: lookupTool(),
      stopWhen: stepCountIs(2),
    })

    expect(result.text).toBe('done')
    const second = requests[1]
    expect(second).toBeDefined()
    const items = second?.['input'] as Record<string, unknown>[]
    expect(items.some((item) => item.type === 'item_reference' && item['id'] === 'rs_live_1')).toBe(true)
    expect(
      items.some(
        (item) => item.type === 'function_call' && item['call_id'] === 'call_1' && item['name'] === 'lookup',
      ),
    ).toBe(true)
    expect(items.some((item) => item.type === 'function_call_output' && item['call_id'] === 'call_1')).toBe(true)
    expect(warnings).toEqual([])
  })

  it('sends a reasoning effort for a gpt-6.1 model through the merged options', async () => {
    const recorder = recordingFetch({ body: TEXT_RESPONSE, contentType: 'application/json' })
    const model = openAiModel({ credentials: apiCredentials(), fetch: recorder.fetch })

    await generateText({
      model,
      prompt: 'ping',
      providerOptions: { openai: { reasoningEffort: 'high' } },
    })

    expect(recorder.requests[0]?.body).toMatchObject({ reasoning: { effort: 'high' } })
  })
})
