import { transcriptOfRange, type Event } from '@dltech/atlas-core'
import { generateText, type LanguageModel } from 'ai'

import { SummaryFailure } from '../model/summariser'
import { NO_SDK_RETRIES } from '../model/no-sdk-retries'

export type RotationSummariser = (args: {
  events: readonly Event[]
  fromSeq: number
  throughSeq: number
  instructions: string
  signal?: AbortSignal | undefined
}) => Promise<string | null>

const CARRY_OVER_PROMPT = [
  'You are compressing your own working context before a log rotation. You will wake with ONLY',
  'this brief plus whatever happens after it; the full transcript stays on disk but is hidden from',
  'your context. Anything you do not write down here, you will not know.',
  '',
  'The transcript you are given is your own session so far. Write the brief to yourself, in the',
  'second person, under exactly these headings, omitting any the transcript does not support:',
  '',
  'Current task — what you are doing right now and the exact state it is in: the goal, what is done,',
  'what is half-finished, what is blocked and on what.',
  '',
  'Locked decisions — calls the operator has settled: scope, constraints, approaches chosen or',
  'ruled out, conventions to follow. Quote their words where intent matters, so you do not',
  're-litigate them.',
  '',
  'Live work — things still running that you started or are waiting on: background shells,',
  'services, sub-agents and teammates, each with its ID, what it is doing, and what you expect from',
  'it. Take this only from the transcript, and drop anything the transcript shows has ended.',
  '',
  'Progress on disk — what has been created, edited, or deleted, by path, with the state of each',
  '(done, in progress, untested), plus branches, commits, and pull requests touched.',
  '',
  'Codebase knowledge — what would cost tool calls to rediscover: where things live, how modules',
  'connect, symbols to reach for, commands that worked, environment quirks.',
  '',
  'Failures and dead ends — what was tried and failed, what the operator rejected, and why, so none',
  'of it is retried.',
  '',
  'Next action — the single next step you will take on waking, and what it needs: paths, commands,',
  'facts. Then, briefly, what follows it.',
  '',
  'Across all sections: preserve exact identifiers — paths, symbols, commands, error text, IDs,',
  'versions — and never invent them. Name credentials and long artifacts by where they live, never',
  'reproduce them. Prefer specific over compact. Reply with the brief alone.',
].join('\n')

export function carryOverSystemPrompt({ instructions }: { instructions: string }): string {
  const operator = instructions.trim()
  if (operator.length === 0) return CARRY_OVER_PROMPT

  return [
    CARRY_OVER_PROMPT,
    '',
    `The operator's instructions for after the rotation: ${operator}`,
    'Fold these into Next action, so you wake knowing to carry them out first.',
  ].join('\n')
}

export function carryOverSummariser({ model }: { model: LanguageModel }): RotationSummariser {
  return async ({ events, fromSeq, throughSeq, instructions, signal }) => {
    const transcript = transcriptOfRange({ events, fromSeq, throughSeq })
    if (transcript.trim().length === 0) return null

    let generated
    try {
      generated = await generateText({
        model,
        system: carryOverSystemPrompt({ instructions }),
        prompt: transcript,
        maxRetries: NO_SDK_RETRIES,
        ...(signal === undefined ? {} : { abortSignal: signal }),
      })
    } catch (fault) {
      if (signal?.aborted === true) return null
      throw new SummaryFailure(fault instanceof Error ? fault.message : String(fault), {
        cause: fault,
      })
    }

    const brief = generated.text.trim()
    return brief.length === 0 ? null : brief
  }
}
