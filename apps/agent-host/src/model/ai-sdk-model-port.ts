import { ModelStreamError, StreamStallError } from '@dltech/atlas-agent'
import { getErrorMessage, type LanguageModelV4 } from '@ai-sdk/provider'
import { stepCountIs, streamText, type LanguageModel } from 'ai'

import {
  carriesToolResultImages,
  DEFAULT_IMAGE_TIER,
  hoistToolResultFiles,
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

import { createPartAccumulator } from './accumulator'
import { toCoreChunk } from './chunk-conversion'
import { reportsFastSpeed } from './fast-speed'
import { toInstructions } from './instructions'
import { providerIdentityOf } from './provider-identity'
import { toModelMessages } from './message-conversion'
import { toProviderPrompt } from './provider-prompt'
import { toToolSet } from './tool-set'

export type { ChunkFilter }

const reportNothing = () => {}

const RETRIES_BELONG_TO_THE_POLICY = 0

export type StreamTimeout = { ttfbMs: number; firstChunkMs: number; chunkMs: number }

export const DEFAULT_STREAM_TIMEOUT: StreamTimeout = {
  ttfbMs: 30_000,
  firstChunkMs: 180_000,
  chunkMs: 120_000,
}

const proxyDoStream = (
  model: LanguageModelV4,
  doStream: (options: DoStreamOptions) => ReturnType<LanguageModelV4['doStream']>,
): LanguageModelV4 =>
  new Proxy(model, {
    get: (target, property, receiver) =>
      property === 'doStream' ? doStream : Reflect.get(target, property, receiver),
  })

type DoStreamOptions = Parameters<LanguageModelV4['doStream']>[0]

const isV4Model = (model: LanguageModel): model is LanguageModelV4 =>
  typeof model === 'object' && model.specificationVersion === 'v4'

function withResponseDeadline(args: { model: LanguageModelV4; ttfbMs: number }): LanguageModelV4 {
  const doStream = (options: DoStreamOptions) => {
    const deadline = new AbortController()
    const followCaller = () => deadline.abort(options.abortSignal?.reason)
    options.abortSignal?.addEventListener('abort', followCaller, { once: true })

    const timer = setTimeout(
      () => deadline.abort(new StreamStallError('the provider did not answer the request in time')),
      args.ttfbMs,
    )

    const answered = args.model.doStream({ ...options, abortSignal: deadline.signal })
    const unanswered = new Promise<never>((_, reject) =>
      deadline.signal.addEventListener('abort', () => reject(deadline.signal.reason), {
        once: true,
      }),
    )

    return Promise.race([answered, unanswered]).finally(() => clearTimeout(timer))
  }

  return proxyDoStream(args.model, doStream)
}

export async function runModelStream(args: {
  model: LanguageModel
  prompt: ProviderPrompt
  tools: readonly ToolDeclaration[]
  signal: AbortSignal
  onChunk?: ChunkFilter
  streamTimeout?: StreamTimeout | undefined
}): Promise<ModelStepResult> {
  const instructions = toInstructions(args.prompt.instructions)

  const timeout = args.streamTimeout ?? DEFAULT_STREAM_TIMEOUT
  const deadlineModel = isV4Model(args.model)
    ? withResponseDeadline({ model: args.model, ttfbMs: timeout.ttfbMs })
    : args.model
  const model = deadlineModel

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
  let ranFast = false

  try {
    for await (const part of stream.stream) {
      if (part.type === 'abort' && !args.signal.aborted) {
        throw new StreamStallError('the model stream went silent past its timeout')
      }

      if (part.type === 'finish-step' && reportsFastSpeed(part.providerMetadata)) ranFast = true

      const chunk = toCoreChunk(part)
      if (chunk === null) continue

      const kept = args.onChunk === undefined ? chunk : await args.onChunk(chunk)
      if (kept !== null) accumulator.handle(kept)

      if (part.type === 'error') {
        if (part.error instanceof StreamStallError) throw part.error
        throw new ModelStreamError({ message: getErrorMessage(part.error), cause: part.error })
      }
    }
  } catch (error) {
    if (!args.signal.aborted) throw error
  }

  const result = accumulator.finish()
  return ranFast ? { ...result, ranFast: true } : result
}

export type ModelCardSource = ModelCard | (() => ModelCard | undefined)

const cardOf = (source: ModelCardSource | undefined): ModelCard | undefined =>
  typeof source === 'function' ? source() : source

export type AiSdkModelPortArgs = {
  model: LanguageModel
  identity?: ProviderIdentity | undefined
  card?: ModelCardSource | undefined
}

export class AiSdkModelPort extends ModelPort {
  private readonly model: LanguageModel
  private readonly declaredIdentity: ProviderIdentity | undefined
  private readonly card: ModelCardSource | undefined

  constructor(args: AiSdkModelPortArgs) {
    super()
    this.model = args.model
    this.declaredIdentity = args.identity
    this.card = args.card
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
      ...(onChunk === undefined ? {} : { onChunk }),
    })
  }

  private async promptFor({ assembled }: { assembled: Assembled }): Promise<ProviderPrompt> {
    const prompt = toProviderPrompt({ assembled, provider: this.identity })
    const carried = carriesToolResultImages(cardOf(this.card))
      ? prompt
      : { ...prompt, messages: hoistToolResultFiles({ messages: prompt.messages }) }
    return carried
  }
}
