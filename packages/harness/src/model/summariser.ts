import { transcriptOfRange, type Event } from '@dltech/atlas-core'
import { generateText, type LanguageModel } from 'ai'

const SUMMARY_INSTRUCTION = [
  'You compact a coding session so the agent can keep working after its earlier turns are dropped.',
  'Write the summary as notes to the agent itself, in the second person.',
  'Cover, in this order and only where the transcript supports it:',
  'what the operator asked for and any constraint they stated;',
  'what has been changed on disk, by path;',
  'what was learned about the codebase that would cost tool calls to rediscover;',
  'what was tried and failed, so it is not tried again;',
  'and what remains to be done.',
  'Preserve exact identifiers — paths, symbols, commands, error text. Never invent them.',
  'Write prose and short lists, no headings. Reply with the summary alone.',
].join(' ')

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
      prompt: transcript,
      ...(args.signal === undefined ? {} : { abortSignal: args.signal }),
    })
  } catch (fault) {
    if (args.signal?.aborted === true) return null
    throw new SummaryFailure(messageOf(fault), { cause: fault })
  }

  const summary = generated.text.trim()
  return summary.length === 0 ? null : summary
}
