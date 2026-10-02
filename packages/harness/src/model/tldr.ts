import { ETldrStatus, transcriptOfRange, type Event } from '@dltech/atlas-core'
import { streamObject, type LanguageModel } from 'ai'
import { z } from 'zod'

const TLDR_INSTRUCTION = [
  'You write the tl;dr footer for one turn of a coding-agent session between Operator and Atlas.',
  'The transcript runs from the operator\u2019s latest message to the end of the turn.',
  'Summarize what Atlas did or found, in one or two short lines, past tense, naming exact paths and',
  'symbols — never inventing them.',
  'Answer what became of the operator\u2019s ask: if the asked-for thing is not done yet, say that plainly.',
  'Report only what the transcript shows done: a plan, proposal, announced intent, or task list is not',
  'done — only a tool call that made the change counts. grep, read and ls change nothing — a turn of',
  'only those found things; it did not change things.',
  'Judge the turn by its last rows: if something it waited on arrived, the wait is over, and if it',
  'repeats an action, the later pass is the outcome. If the transcript ends on tool calls or results',
  'with no closing word from Atlas, the turn ended mid-work: say what it was doing, never the planned',
  'end state.',
  'Say the outcome, not the itinerary — never enumerate more than two paths or symbols.',
  'The status says how the turn ended:',
  '- "done": the operator\u2019s ask is answered and nothing remains outstanding;',
  '- "needs-operator": the turn ended on a question, a plan or a decision for the operator;',
  '- "waiting": background work is the sole thing outstanding and it will wake Atlas on its own.',
  '"needs-operator" is the default whenever the ending is ambiguous or mixed. Choose "done" or',
  '"waiting" only when the ending is plainly that and nothing else.',
].join(' ')

const tldrSchema = z.object({
  status: z.enum(ETldrStatus),
  summary: z.string(),
})

export type TldrResult = { text: string; status: ETldrStatus }

const TURN_PAYLOAD_CHARACTER_LIMIT = 4_000

export function tldrPrompt({
  events,
  anchorSeq,
  throughSeq,
}: {
  events: readonly Event[]
  anchorSeq: number
  throughSeq: number
}): string | null {
  const turn = transcriptOfRange({
    events,
    fromSeq: anchorSeq,
    throughSeq,
    payloadLimit: TURN_PAYLOAD_CHARACTER_LIMIT,
  }).trim()
  if (turn.length === 0) return null

  return turn
}

export async function tldrFor(args: {
  model: LanguageModel
  events: readonly Event[]
  anchorSeq: number
  throughSeq: number
  signal?: AbortSignal | undefined
  onChunk?: ((text: string) => void) | undefined
}): Promise<TldrResult | null> {
  const prompt = tldrPrompt({
    events: args.events,
    anchorSeq: args.anchorSeq,
    throughSeq: args.throughSeq,
  })
  if (prompt === null) return null

  try {
    const stream = streamObject({
      model: args.model,
      schema: tldrSchema,
      system: TLDR_INSTRUCTION,
      prompt,
      onError: () => undefined,
      ...(args.signal === undefined ? {} : { abortSignal: args.signal }),
    })

    for await (const partial of stream.partialObjectStream) {
      if (typeof partial.summary === 'string') args.onChunk?.(partial.summary)
    }

    const result = await stream.object
    const text = result.summary.trim()
    return text.length === 0 ? null : { text, status: result.status }
  } catch {
    return null
  }
}
