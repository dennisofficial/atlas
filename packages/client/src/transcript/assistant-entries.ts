import {
  EAssistantPlaceholder,
  type AssistantPart,
  type CallId,
  type Event,
  type EventId,
  type EventOfType,
} from '@dltech/atlas-core'

import { modelEntries } from './model-entries'
import type { TranscriptEntry } from './transcript-model'

type PartRun = { type: AssistantPart['type']; text: string }

function runsOfParts(parts: readonly AssistantPart[]): PartRun[] {
  const runs: PartRun[] = []

  for (const part of parts) {
    const open = runs.at(-1)
    if (open?.type === part.type) {
      open.text += part.text
      continue
    }

    runs.push({ type: part.type, text: part.text })
  }

  return runs
}

export function entriesOfAssistantEvent(event: EventOfType<'assistant-said'>): TranscriptEntry[] {
  const muted = event.placeholder === EAssistantPlaceholder.NoContent
  return modelEntries({
    runs: runsOfParts(event.parts).map((run, index) => ({
      key: `${event.id}#${index}`,
      text: run.text,
      isReasoning: run.type === 'reasoning',
      muted,
    })),
    streaming: false,
    interruptedAtEnd: event.interrupted === true,
  })
}

export function saidWhileToolsWereOutstanding(events: readonly Event[]): ReadonlySet<EventId> {
  const outstanding = new Set<CallId>()
  const steers = new Set<EventId>()

  for (const event of events) {
    if (event.type === 'tool-called') outstanding.add(event.callId)
    if (event.type === 'tool-result' || event.type === 'tool-denied') {
      outstanding.delete(event.callId)
    }
    if (event.type === 'user-said' && outstanding.size > 0) steers.add(event.id)
  }

  return steers
}
