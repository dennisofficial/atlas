import type { UIMessage, UIMessageChunk } from 'ai'
import type { EventRef } from '@dltech/atlas-core'

import type { EStepEnd } from '../channel'

export type AtlasStepMetadata = {
  stepId: string
  end: EStepEnd | null
  supersededBy: EventRef | null
  errorMessage: string | null
  callsAt: Record<string, string>
}

export type AtlasStepMessage = UIMessage<AtlasStepMetadata>

export type AtlasStepChunk = UIMessageChunk<Partial<AtlasStepMetadata>>
