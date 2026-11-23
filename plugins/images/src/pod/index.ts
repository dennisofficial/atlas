import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import {
  EGenerateRefusal,
  EGenerateRoute,
  GATEWAY_MODELS_URL,
  generateWithGateway,
  isZeroDataRetention,
  routeOf,
  ZDR_FALLBACK_MODELS,
  zdrImageModels,
  zdrImageModelsIn,
} from './generate'
import { ImageGenerateTool } from './image-generate-tool'

export {
  EGenerateRefusal,
  EGenerateRoute,
  GATEWAY_MODELS_URL,
  ZDR_FALLBACK_MODELS,
  generateWithGateway,
  isZeroDataRetention,
  routeOf,
  zdrImageModels,
  zdrImageModelsIn,
}
export type {
  GenerateImageInput,
  GenerateOutcome,
  GenerateSdk,
  SdkPicture,
} from './generate'
export { ImageGenerateTool, type ImageGenerateDeps } from './image-generate-tool'

export const IMAGES_TOOLS = ['image_generate'] as const

export const imagesPod: PodSlot = {
  ...EMPTY_POD,
  tools: (ctx) => [new ImageGenerateTool(ctx)],
}
