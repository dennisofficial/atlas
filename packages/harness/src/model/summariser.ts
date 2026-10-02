import { transcriptOfRange, type Event } from '@dltech/atlas-core'
import { generateText, type LanguageModel } from 'ai'

const SUMMARY_INSTRUCTION = [
  'You compact a coding session so the agent can keep working after its earlier turns are dropped.',
  'The summary replaces those turns entirely, so anything the agent still needs must be in it.',
  '',
  'Write the summary as notes to the agent itself, in the second person, under these sections —',
  'omitting any the transcript does not support:',
  '',
  'Request and constraints — what the operator asked for, and every constraint they stated or',
  'confirmed, including decisions discussed and settled along the way. Quote their words where intent',
  'matters.',
  '',
  'Progress and changes on disk — what has been created, edited, or deleted, by path, with the state',
  'of each (done, in progress, blocked).',
  '',
  'Codebase knowledge — what would cost tool calls to rediscover: how modules connect, where things',
  'live, conventions found, commands that worked, environment quirks.',
  '',
  'Failures and rejections — what was tried and failed, which approaches the operator ruled out, and',
  'why, so none of it is retried.',
  '',
  'Open work — what remains, in order: the immediate next step, then everything after it, with the',
  'paths and facts each step depends on.',
  '',
  'Live state — running shells, services, and sub-agents, with their IDs and ports; credentials and',
  'endpoints named by where they live, never reproduced; long artifacts referenced by path, never',
  'copied.',
  '',
  'Across all sections: preserve exact identifiers — paths, symbols, commands, error text, versions —',
  'and never invent them. Prefer specific over compact: a fact that costs a tool call to relearn',
  'belongs here even when it feels minor. Reply with the summary alone.',
].join('\n')

const TRANSCRIPT_CHARACTER_LIMIT = 400_000
const SUMMARY_OUTPUT_TOKEN_LIMIT = 2_000

export class SummaryFailure extends Error {
  override readonly name = 'SummaryFailure'
}

const messageOf = (fault: unknown): string =>
  fault instanceof Error ? fault.message : String(fault)

export async function summaryFor(args: {
  model: LanguageModel
  events: readonly Event[]
  fromSeq: number
  throughSeq: number
  signal?: AbortSignal | undefined
}): Promise<string | null> {
  const transcript = transcriptOfRange({
    events: args.events,
    fromSeq: args.fromSeq,
    throughSeq: args.throughSeq,
  })
  if (transcript.trim().length === 0) return null

  let generated
  try {
    generated = await generateText({
      model: args.model,
      system: SUMMARY_INSTRUCTION,
      prompt: transcript.slice(-TRANSCRIPT_CHARACTER_LIMIT),
      maxOutputTokens: SUMMARY_OUTPUT_TOKEN_LIMIT,
      ...(args.signal === undefined ? {} : { abortSignal: args.signal }),
    })
  } catch (fault) {
    if (args.signal?.aborted === true) return null
    throw new SummaryFailure(messageOf(fault), { cause: fault })
  }

  const summary = generated.text.trim()
  return summary.length === 0 ? null : summary
}
