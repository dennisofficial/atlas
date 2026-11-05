import type { LanguageModelV4 } from '@ai-sdk/provider'
import {
  DIAGRAM_REPAIR_SYSTEM,
  diagramRepairPrompt,
  repairedSourceOf,
  type EventId,
  type EventLogPort,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'
import { generateText } from 'ai'

import { NO_SDK_RETRIES } from '../model/no-sdk-retries'
import { DiagramRepairPort, type DiagramRepairOutcome } from './diagram-repair-port'

export class LocalDiagramRepair extends DiagramRepairPort {
  private readonly log: EventLogPort
  private readonly model: () => LanguageModelV4 | undefined
  private readonly modelId: () => string
  private readonly runId: () => RunId

  constructor(args: {
    log: EventLogPort
    model: () => LanguageModelV4 | undefined
    modelId: () => string
    runId: () => RunId
  }) {
    super()
    this.log = args.log
    this.model = args.model
    this.modelId = args.modelId
    this.runId = args.runId
  }

  async repair(args: {
    threadId: ThreadId
    messageId: EventId
    source: string
    error: string
    signal?: AbortSignal | undefined
  }): Promise<DiagramRepairOutcome> {
    const model = this.model()
    if (model === undefined) return { kind: 'failed', reason: 'the session model is unavailable' }

    try {
      const modelId = this.modelId()
      const generated = await generateText({
        model,
        system: DIAGRAM_REPAIR_SYSTEM,
        prompt: diagramRepairPrompt({ source: args.source, error: args.error }),
        maxRetries: NO_SDK_RETRIES,
        ...(args.signal === undefined ? {} : { abortSignal: args.signal }),
      })
      const repaired = repairedSourceOf(generated.text)
      if (repaired === undefined) return { kind: 'failed', reason: 'the model returned no diagram' }
      if (repaired === args.source.trim()) {
        return { kind: 'failed', reason: 'the model returned the diagram unchanged' }
      }

      await this.log.append({
        threadId: args.threadId,
        runId: this.runId(),
        drafts: [
          {
            type: 'diagram-repaired',
            messageId: args.messageId,
            original: args.source,
            repaired,
            modelId,
          },
        ],
      })
      return { kind: 'repaired', repaired }
    } catch (error) {
      return {
        kind: 'failed',
        reason: error instanceof Error ? error.message : 'the diagram repair failed',
      }
    }
  }
}
