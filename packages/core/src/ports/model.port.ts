import type { Assembled } from '../assembly/assembled'
import type { ImageCapabilities } from '../images/delivery'
import { DEFAULT_IMAGE_TIER, type EImageTier } from '../images/projection'
import type { AssistantPart } from '../events/body'
import type { CallId } from '../events/ids'
import type { ProviderIdentity } from '../provider'
import type { ModelCost } from '../models/card'
import type { Chunk, EFinishReason, ModelUsage } from '../stream/chunk'
import type { ToolDeclaration } from '../tools/tool'

export type ModelToolCall = { callId: CallId; name: string; input: unknown }

export type ChunkFilter = (chunk: Chunk) => Chunk | null

export type ModelStepResult = {
  parts: readonly AssistantPart[]
  toolCalls: readonly ModelToolCall[]
  finishReason: EFinishReason
  usage?: ModelUsage
  ranFast?: true
}

import type { EAuthKind } from '../credentials/account'

export type ModelTraits = {
  imageTier?: EImageTier | undefined
  image?: ImageCapabilities | undefined
  contextWindow?: number | undefined
  cost?: ModelCost | undefined
  auth?: EAuthKind | undefined
}

export const CONTEXT_WINDOW_UNMEASURED = 0

export const imageTierOf = (model: { traits?: () => ModelTraits }): EImageTier =>
  model.traits?.().imageTier ?? DEFAULT_IMAGE_TIER

export const contextWindowOf = (model: { traits?: () => ModelTraits }): number =>
  model.traits?.().contextWindow ?? CONTEXT_WINDOW_UNMEASURED

export const costOf = (model: { traits?: () => ModelTraits }): ModelCost | undefined =>
  model.traits?.().cost

export abstract class ModelPort {
  abstract readonly identity: ProviderIdentity

  traits?(): ModelTraits

  abstract step(args: {
    assembled: Assembled
    tools: readonly ToolDeclaration[]
    signal: AbortSignal
    onChunk?: ChunkFilter
  }): Promise<ModelStepResult>
}
