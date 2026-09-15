import { getErrorMessage, type LanguageModelV4 } from '@ai-sdk/provider'
import { stepCountIs, streamText, type LanguageModel } from 'ai'

import {
  DEFAULT_IMAGE_TIER,
  ModelPort,
  type Assembled,
  type Chunk,
  type ChunkFilter,
  type ModelCard,
  type ModelStepResult,
  type ModelTraits,
  type ProviderIdentity,
  type ProviderPrompt,
  type ToolDeclaration,
} from '@dltech/atlas-core'

import type { HookChain } from '../hooks/registry'
import { NO_RAW_TAPE, type RawTape } from './raw-tape'
import { createPartAccumulator } from './accumulator'
import { toCoreChunk } from './chunk-conversion'
import { ModelStreamError, StreamStallError } from './errors'
import { toInstructions } from './instructions'
import { providerIdentityOf } from './provider-identity'
import { toModelMessages } from './message-conversion'
import { toProviderPrompt } from './provider-prompt'
import { toToolSet } from './tool-set'

export type { ChunkFilter }

// streamText's default onError writes the error to the console, and a stray console write corrupts
// the terminal renderer.
const reportNothing = () => {}

// streamText defaults to maxRetries: 2, and those attempts happen inside one call to it — so they
// pass no notice to the retry policy above and the operator sees an idle spinner for as long as
// they take. https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text
const RETRIES_BELONG_TO_THE_POLICY = 0

export type StreamTimeout = { ttfbMs: number; firstChunkMs: number; chunkMs: number }

// streamText arms no timeout unless one is passed, and Bun's fetch has no default idle timeout —
// so a provider that holds the connection open but goes silent would block the for-await below
// until esc. The first chunk gets a longer grace because prefill of a large context is legitimately
// slow. https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text#timeout
//
// firstChunkMs itself only starts ticking once doStream resolves — i.e. once response headers
// arrive — so a provider that queues the request without answering (observed from inference.net
// under load, 2026-09-15: live turns silent for 3-50 minutes with no retry line) sits outside every
// watchdog. ttfbMs covers that window by racing doStream against a timer.
const DEFAULT_STREAM_TIMEOUT: StreamTimeout = {
  ttfbMs: 90_000,
  firstChunkMs: 180_000,
  chunkMs: 120_000,
}

type DoStreamOptions = Parameters<LanguageModelV4['doStream']>[0]

const isV4Model = (model: LanguageModel): model is LanguageModelV4 =>
  typeof model === 'object' && model.specificationVersion === 'v4'

function withResponseDeadline(args: { model: LanguageModelV4; ttfbMs: number }): LanguageModelV4 {
  const doStream = (options: DoStreamOptions) => {
    const deadline = new AbortController()
    const followCaller = () => deadline.abort(options.abortSignal?.reason)
    options.abortSignal?.addEventListener('abort', followCaller, { once: true })

    const timer = setTimeout(
      () =>
        deadline.abort(new StreamStallError('the provider did not answer the request in time')),
      args.ttfbMs,
    )

    const answered = args.model.doStream({ ...options, abortSignal: deadline.signal })
    const unanswered = new Promise<never>((_, reject) =>
      deadline.signal.addEventListener('abort', () => reject(deadline.signal.reason), {
        once: true,
      }),
    )

    // The caller listener outlives the race on purpose: deadline.signal drives the request for
    // the stream's whole life, so an esc mid-stream must still reach it.
    return Promise.race([answered, unanswered]).finally(() => clearTimeout(timer))
  }

  return new Proxy(args.model, {
    get: (target, property, receiver) =>
      property === 'doStream' ? doStream : Reflect.get(target, property, receiver),
  })
}

async function keptChunk(args: {
  chunk: Chunk
  hooks: HookChain | undefined
  filter?: ChunkFilter | undefined
}): Promise<Chunk | null> {
  const observed =
    args.hooks === undefined ? args.chunk : await args.hooks.onChunk({ chunk: args.chunk })
  if (observed === null) return null
  if (args.filter === undefined) return observed
  return args.filter(observed)
}

export async function runModelStream(args: {
  model: LanguageModel
  prompt: ProviderPrompt
  tools: readonly ToolDeclaration[]
  signal: AbortSignal
  onChunk?: ChunkFilter
  hooks?: HookChain | undefined
  tape?: RawTape | undefined
  streamTimeout?: StreamTimeout | undefined
}): Promise<ModelStepResult> {
  const instructions = toInstructions(args.prompt.instructions)
  const tape = args.tape ?? NO_RAW_TAPE

  const timeout = args.streamTimeout ?? DEFAULT_STREAM_TIMEOUT
  const model = isV4Model(args.model)
    ? withResponseDeadline({ model: args.model, ttfbMs: timeout.ttfbMs })
    : args.model

  const stream = streamText({
    model,
    ...(instructions.length > 0 ? { instructions } : {}),
    messages: toModelMessages(args.prompt.messages),
    tools: toToolSet(args.tools),
    stopWhen: stepCountIs(1),
    abortSignal: args.signal,
    maxRetries: RETRIES_BELONG_TO_THE_POLICY,
    timeout: { firstChunkMs: timeout.firstChunkMs, chunkMs: timeout.chunkMs },
    onError: reportNothing,
    ...(args.prompt.requestOptions === undefined
      ? {}
      : { providerOptions: args.prompt.requestOptions }),
  })

  const accumulator = createPartAccumulator()

  try {
    for await (const part of stream.fullStream) {
      tape.tap(part)

      // The SDK answers its own stream timeout with a graceful `abort` part, indistinguishable
      // from an esc interrupt except that our signal was never aborted. Turn it back into the
      // failure it is, or a stall would surface as a silently truncated step.
      if (part.type === 'abort' && !args.signal.aborted) {
        throw new StreamStallError('the model stream went silent past its timeout')
      }

      const chunk = toCoreChunk(part)
      if (chunk === null) continue

      const kept = await keptChunk({ chunk, hooks: args.hooks, filter: args.onChunk })
      if (kept !== null) accumulator.handle(kept)

      if (part.type === 'error') {
        if (part.error instanceof StreamStallError) throw part.error
        throw new ModelStreamError({ message: getErrorMessage(part.error), cause: part.error })
      }
    }
  } catch (error) {
    if (!args.signal.aborted) throw error
  }

  return accumulator.finish()
}

export type ModelCardSource = ModelCard | (() => ModelCard | undefined)

const cardOf = (source: ModelCardSource | undefined): ModelCard | undefined =>
  typeof source === 'function' ? source() : source

export type AiSdkModelPortArgs = {
  model: LanguageModel
  identity?: ProviderIdentity | undefined
  card?: ModelCardSource | undefined
  hooks?: HookChain | undefined
  tape?: RawTape | undefined
}

export class AiSdkModelPort extends ModelPort {
  private readonly model: LanguageModel
  private readonly declaredIdentity: ProviderIdentity | undefined
  private readonly card: ModelCardSource | undefined
  private readonly hooks: HookChain | undefined
  private readonly tape: RawTape | undefined

  constructor(args: AiSdkModelPortArgs) {
    super()
    this.model = args.model
    this.declaredIdentity = args.identity
    this.card = args.card
    this.hooks = args.hooks
    this.tape = args.tape
  }

  get identity(): ProviderIdentity {
    return this.declaredIdentity ?? providerIdentityOf(this.model)
  }

  override traits(): ModelTraits {
    const card = cardOf(this.card)

    return {
      imageTier: card?.imageTier ?? DEFAULT_IMAGE_TIER,
      ...(card === undefined ? {} : { contextWindow: card.contextWindow }),
    }
  }

  async step({
    assembled,
    tools,
    signal,
    onChunk,
  }: {
    assembled: Assembled
    tools: readonly ToolDeclaration[]
    signal: AbortSignal
    onChunk?: ChunkFilter
  }): Promise<ModelStepResult> {
    return runModelStream({
      model: this.model,
      prompt: await this.promptFor({ assembled }),
      tools,
      signal,
      ...(this.hooks === undefined ? {} : { hooks: this.hooks }),
      ...(onChunk === undefined ? {} : { onChunk }),
      ...(this.tape === undefined ? {} : { tape: this.tape }),
    })
  }

  private async promptFor({ assembled }: { assembled: Assembled }): Promise<ProviderPrompt> {
    const prompt = toProviderPrompt({ assembled, provider: this.identity })
    if (this.hooks === undefined) return prompt
    return this.hooks.beforeRequest({ prompt })
  }
}
