import type { LanguageModelV4 } from '@ai-sdk/provider'
import {
  DIAGRAM_REPAIR_SYSTEM,
  diagramRepairOutcomeOf,
  diagramRepairPrompt,
  type DiagramRepairOutcome,
} from '@dltech/atlas-core'
import { generateText } from 'ai'

const NO_SDK_RETRIES = 0

export async function repairDiagramText(args: {
  model: () => LanguageModelV4
  source: string
  error: string
  context?: string | undefined
  signal?: AbortSignal | undefined
}): Promise<DiagramRepairOutcome> {
  const generated = await generateText({
    model: args.model(),
    system: DIAGRAM_REPAIR_SYSTEM,
    prompt: diagramRepairPrompt({
      source: args.source,
      error: args.error,
      context: args.context,
    }),
    maxRetries: NO_SDK_RETRIES,
    ...(args.signal === undefined ? {} : { abortSignal: args.signal }),
  })
  return diagramRepairOutcomeOf({ source: args.source, reply: generated.text })
}
