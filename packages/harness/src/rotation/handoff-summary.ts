import { transcriptOfRange, type Event } from '@dltech/atlas-core'
import { generateText, type LanguageModel } from 'ai'

import { SummaryFailure } from '../model/summariser'

export type RotationSummariser = (args: {
  events: readonly Event[]
  fromSeq: number
  throughSeq: number
  instructions: string
  signal?: AbortSignal | undefined
}) => Promise<string | null>

const HANDOFF_INSTRUCTION = [
  'You write the handoff note for a coding session whose main agent is being rotated forward.',
  'A fresh agent inherits this session and starts from your note plus the operator instructions,',
  'so anything the successor still needs must be here. The predecessor transcript stays on disk',
  'but the successor never re-reads it — your note is the whole bridge.',
  '',
  'Write notes to the successor agent, in the second person, under these sections — omitting any',
  'the transcript does not support:',
  '',
  'Where things stand — what the session was doing when rotation was requested, and the state of',
  'each piece of work (done, in progress, blocked).',
  '',
  'Request and constraints — what the operator asked for across the session, every constraint',
  'they stated or confirmed, and decisions settled along the way. Quote their words where intent',
  'matters.',
  '',
  'Progress on disk — what has been created, edited, or deleted, by path.',
  '',
  'Codebase knowledge — what would cost tool calls to rediscover: how modules connect, where',
  'things live, conventions found, commands that worked, environment quirks.',
  '',
  'Failures and rejections — what was tried and failed, which approaches the operator ruled out,',
  'and why, so none of it is retried.',
  '',
  'Open work — what remains, in order, with the paths and facts each step depends on.',
  '',
  'Across all sections: preserve exact identifiers — paths, symbols, commands, error text,',
  'versions — and never invent them. Prefer specific over compact. Reply with the handoff alone.',
].join('\n')

export function watermarkHead({ events }: { events: readonly Event[] }): number | undefined {
  return events.at(-1)?.seq
}

export function handoffSummariser({ model }: { model: LanguageModel }): RotationSummariser {
  return async ({ events, fromSeq, throughSeq, instructions, signal }) => {
    const transcript = transcriptOfRange({ events, fromSeq, throughSeq })
    if (transcript.trim().length === 0) return null

    const prompt =
      instructions.trim().length === 0
        ? transcript
        : `${transcript}\n\nThe operator's rotation instructions for the successor: ${instructions}`

    let generated
    try {
      generated = await generateText({
        model,
        system: HANDOFF_INSTRUCTION,
        prompt,
        ...(signal === undefined ? {} : { abortSignal: signal }),
      })
    } catch (fault) {
      if (signal?.aborted === true) return null
      throw new SummaryFailure(fault instanceof Error ? fault.message : String(fault), { cause: fault })
    }

    const narrative = generated.text.trim()
    return narrative.length === 0 ? null : narrative
  }
}
