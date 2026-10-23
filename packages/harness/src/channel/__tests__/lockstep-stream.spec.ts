import { afterEach, describe, expect, it } from 'bun:test'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { MockLanguageModelV4 } from 'ai/test'
import { z } from 'zod'

import { defaultPipeline, EMPTY_PROMPT, EToolEffect, type ToolDefinition } from '@dltech/atlas-core'

import { createDeltaChannel, PublishingTurnRunner, type ChannelSignal } from '..'
import { buildHarness, type AtlasHarness } from '../../loop'
import { createTempHome, type TempHome } from '../../loop/__tests__/temp-home'
import { HookChain } from '../../hooks/registry'
import { HookedToolDispatcher } from '../../tools/dispatch'
import { InMemoryToolRegistry } from '../../tools/registry'

const opened: { harness: AtlasHarness; temp: TempHome }[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.harness.close()
    entry.temp.discard()
  }
})

const readTool: ToolDefinition = {
  name: 'read',
  description: 'read a file',
  effect: EToolEffect.Read,
  inputSchema: z.object({ path: z.string() }),
  invoke: async () => ({ ok: true, output: 'const a = 1', modelText: '1\tconst a = 1' }),
}

type PushStream = {
  stream: ReadableStream<LanguageModelV4StreamPart>
  push: (part: LanguageModelV4StreamPart) => void
  close: () => void
}

function pushStream(): PushStream {
  let controller: ReadableStreamDefaultController<LanguageModelV4StreamPart> | undefined
  const stream = new ReadableStream<LanguageModelV4StreamPart>({
    start: (opened) => {
      controller = opened
    },
  })
  return {
    stream,
    push: (part) => controller?.enqueue(part),
    close: () => controller?.close(),
  }
}

function lockstepModel(): { model: MockLanguageModelV4; nextStep: () => Promise<PushStream> } {
  const steps: PushStream[] = []
  const waiting: ((step: PushStream) => void)[] = []
  let handed = 0

  const model = new MockLanguageModelV4({
    doStream: async () => {
      const step = pushStream()
      steps.push(step)
      waiting.shift()?.(step)
      return { stream: step.stream }
    },
  })

  const nextStep = (): Promise<PushStream> => {
    const index = handed
    handed += 1
    const existing = steps[index]
    if (existing !== undefined) return Promise.resolve(existing)
    return new Promise((resolve) => waiting.push(resolve))
  }

  return { model, nextStep }
}

const FINISH_USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

async function until(args: { holds: () => boolean; what: string }): Promise<void> {
  const deadline = Date.now() + 500
  while (!args.holds()) {
    if (Date.now() > deadline) throw new Error(`never published: ${args.what}`)
    await Bun.sleep(1)
  }
}

const SECOND_STEP_OPENINGS: Record<string, readonly LanguageModelV4StreamPart[]> = {
  'nothing but stream-start': [{ type: 'stream-start', warnings: [] }],
  'response metadata': [
    { type: 'stream-start', warnings: [] },
    { type: 'response-metadata', id: 'msg_2', modelId: 'scripted' },
  ],
  'a finished reasoning block': [
    { type: 'stream-start', warnings: [] },
    { type: 'reasoning-start', id: 'r1' },
    { type: 'reasoning-delta', id: 'r1', delta: 'weighing it' },
    { type: 'reasoning-end', id: 'r1' },
  ],
  'an empty reasoning block': [
    { type: 'stream-start', warnings: [] },
    { type: 'reasoning-start', id: 'r1' },
    { type: 'reasoning-delta', id: 'r1', delta: '' },
    { type: 'reasoning-end', id: 'r1' },
  ],
  'a zero-length text delta': [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't2' },
    { type: 'text-delta', id: 't2', delta: '' },
  ],
}

const ANSWER_DELTAS = Array.from({ length: 40 }, (_, index) => `word${index} `)

describe('a streamed turn, released one model part at a time', () => {
  for (const [opening, parts] of Object.entries(SECOND_STEP_OPENINGS)) {
    it(`publishes every delta of the step after a tool result that opens with ${opening}`, async () => {
      const temp = createTempHome()
      const { model, nextStep } = lockstepModel()
      const harness = await buildHarness({ home: temp.home, model })
      opened.push({ harness, temp })

      const registry = new InMemoryToolRegistry([readTool])
      const channel = createDeltaChannel()
      const runner = new PublishingTurnRunner({
        channel,
        deps: {
          log: harness.log,
          model: harness.model,
          ids: harness.ids,
          assembly: defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: '/w' }),
          tools: () => registry.declarations(),
          dispatch: new HookedToolDispatcher({ registry, hooks: new HookChain({}) }),
        },
      })
      const thread = await harness.threads.create({})

      const published: string[] = []
      channel.subscribe({
        threadId: thread.id,
        listener: (signal: ChannelSignal) => {
          if (signal.type !== 'chunk') return
          if (signal.chunk.type === 'text-delta') published.push(signal.chunk.text)
        },
      })

      const turn = runner.say({ threadId: thread.id, text: 'read a.ts' })

      const first = await nextStep()
      first.push({ type: 'stream-start', warnings: [] })
      first.push({ type: 'text-start', id: 't1' })
      first.push({ type: 'text-delta', id: 't1', delta: 'reading' })
      await until({ holds: () => published.join('') === 'reading', what: 'reading' })
      first.push({ type: 'text-end', id: 't1' })
      first.push({
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'read',
        input: JSON.stringify({ path: 'a.ts' }),
      })
      first.push({
        type: 'finish',
        usage: FINISH_USAGE,
        finishReason: { unified: 'tool-calls', raw: undefined },
      })
      first.close()

      const second = await nextStep()
      for (const part of parts) second.push(part)
      if (!parts.some((part) => part.type === 'text-start'))
        second.push({ type: 'text-start', id: 't2' })

      let expected = 'reading'
      for (const delta of ANSWER_DELTAS) {
        second.push({ type: 'text-delta', id: 't2', delta })
        expected += delta
        const sought = expected
        await until({ holds: () => published.join('') === sought, what: JSON.stringify(delta) })
      }

      second.push({ type: 'text-end', id: 't2' })
      second.push({
        type: 'finish',
        usage: FINISH_USAGE,
        finishReason: { unified: 'stop', raw: undefined },
      })
      second.close()
      await turn
    })
  }
})
