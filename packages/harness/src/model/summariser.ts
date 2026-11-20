import { transcriptOfRange, type Event } from '@dltech/atlas-core'
import { generateText, type LanguageModel } from 'ai'

import { NO_SDK_RETRIES } from './no-sdk-retries'

const SUMMARY_INSTRUCTION = [
  'You compact a coding session so the agent can keep working after its earlier turns are dropped.',
  'The summary replaces those turns entirely. Anything the agent still needs must be in it.',
  '',
  'Write the summary as notes to the agent itself, in the second person.',
  'Use these sections, and leave out any the transcript does not support:',
  '',
  'Request and constraints — what the operator asked for, and every constraint the operator stated',
  'or confirmed, including decisions discussed and settled along the way. Quote the words of the',
  'operator where intent matters.',
  '',
  'Progress and changes on disk — what has been created, edited, or deleted, by path, with the state',
  'of each: done, in progress, or blocked.',
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
  'Live state — running background shells, services and sub-agents, with their IDs and ports. Name',
  'credentials and endpoints by where they live, and never reproduce them. Reference long artifacts',
  'by path, and never copy them.',
  '',
  'Across all sections, preserve exact identifiers: paths, symbols, commands, error text, versions.',
  'Never invent them. Prefer specific over compact: a fact that costs a tool call to relearn belongs',
  'here even when it feels minor. Reply with the summary alone.',
].join('\n')

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
      maxRetries: NO_SDK_RETRIES,
      ...(args.signal === undefined ? {} : { abortSignal: args.signal }),
    })
  } catch (fault) {
    if (args.signal?.aborted === true) return null
    throw new SummaryFailure(messageOf(fault), { cause: fault })
  }

  const summary = generated.text.trim()
  return summary.length === 0 ? null : summary
}
