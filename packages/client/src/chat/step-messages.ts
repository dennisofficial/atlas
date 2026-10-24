import { EBlockKind, toCallId } from '@dltech/atlas-core'

import { toStepId } from '../channel'
import type { InFlightStep, StepBlock } from '../transcript/in-flight-steps'
import type { LiveToolCall } from '../transcript/tool-runs'
import type { AtlasStepMessage } from './atlas-step-message'

function stepOfMessage(message: AtlasStepMessage): InFlightStep {
  const callsAt = message.metadata?.callsAt ?? {}
  const blocks: StepBlock[] = []
  const calls: LiveToolCall[] = []

  for (const part of message.parts) {
    if (part.type === 'text' || part.type === 'reasoning') {
      const kind = part.type === 'text' ? EBlockKind.Text : EBlockKind.Reasoning
      blocks.push({ id: `${kind}:${blocks.length}`, kind, text: part.text })
    }
    if (part.type === 'dynamic-tool') {
      calls.push({
        callId: toCallId(part.toolCallId),
        name: part.toolName,
        input: part.input,
        at: callsAt[part.toolCallId] ?? null,
        precededByBlocks: blocks.length,
      })
    }
  }

  return {
    stepId: toStepId(message.metadata?.stepId ?? message.id),
    blocks,
    calls,
    end: message.metadata?.end ?? null,
    supersededBy: message.metadata?.supersededBy ?? null,
    errorMessage: message.metadata?.errorMessage ?? null,
  }
}

export const stepsOfMessages = (messages: readonly AtlasStepMessage[]): InFlightStep[] =>
  messages.map(stepOfMessage)
