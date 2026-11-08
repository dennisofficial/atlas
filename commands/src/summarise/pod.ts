import type { CommandHandler } from '@dltech/atlas-commands'
import {
  ECompactionAnchor,
  SUMMARY_REFUSAL_NOTHING,
  summaryTargetOf,
  transcriptOfRange,
  type EventRef,
  type ModelPort,
} from '@dltech/atlas-core'

import { SUMMARY_INSTRUCTION } from './prompt'
import { summariseArgs } from './spec'

export const REFUSAL_NO_MODEL = 'This session has no model to summarise with'
export const REFUSAL_EMPTY_SUMMARY = 'The summary came back empty'
export const REFUSAL_SUMMARY_FAILED = 'The summary could not be written'

export const SUMMARY_TIMEOUT_MS = 120_000

const summaryFrom = async ({
  model,
  origin,
  transcript,
}: {
  model: ModelPort
  origin: EventRef
  transcript: string
}): Promise<string> => {
  const result = await model.step({
    assembled: {
      system: [{ text: SUMMARY_INSTRUCTION }],
      messages: [
        { message: { role: 'user', content: [{ type: 'text', text: transcript }] }, origin },
      ],
    },
    tools: [],
    signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
  })
  return result.parts
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('')
    .trim()
}

export const summariseHandler: CommandHandler<unknown> = async ({
  args,
  model,
  visibleEvents,
  append,
  log,
}) => {
  const parsed = summariseArgs.safeParse(args)
  if (!parsed.success) return { kind: 'refused', reason: parsed.error.message }
  if (model === undefined) return { kind: 'refused', reason: REFUSAL_NO_MODEL }
  const events = visibleEvents()
  const target = summaryTargetOf({ events, throughSeq: parsed.data.throughSeq })
  if (!target.ok) return { kind: 'refused', reason: target.reason }
  const { fromSeq, throughSeq } = target
  const last = events.findLast((event) => event.seq <= throughSeq)
  if (last === undefined) return { kind: 'refused', reason: SUMMARY_REFUSAL_NOTHING }
  const origin = { eventId: last.id, seq: last.seq }
  const transcript = transcriptOfRange({ events, fromSeq, throughSeq })
  let summary: string
  try {
    summary = await summaryFrom({ model, origin, transcript })
  } catch (failure) {
    const detail = failure instanceof Error ? failure.message : String(failure)
    return { kind: 'refused', reason: `${REFUSAL_SUMMARY_FAILED}: ${detail}` }
  }
  if (summary.length === 0) return { kind: 'refused', reason: REFUSAL_EMPTY_SUMMARY }
  await append([
    { type: 'history-summarised', fromSeq, throughSeq, anchor: ECompactionAnchor.Prefix, summary },
  ])
  log(`summarised seq ${fromSeq} through ${throughSeq}`)
  return { kind: 'done' }
}
