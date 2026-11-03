import { estimateMessageTokens } from '../assembly/tokens'
import type { EventBody, StepReading } from '../events/body'
import type { Event } from '../events/envelope'
import type { Message } from '../message/message'
import type { ToolCallPart, ToolResultOutput, ToolResultPart } from '../message/parts'
import type { ModelUsage } from '../stream/chunk'

const callPart = (args: { name: string; input: unknown }): ToolCallPart => ({
  type: 'tool-call',
  toolCallId: args.name,
  toolName: args.name,
  input: args.input,
})

const resultPart = (args: { name: string; output: ToolResultOutput }): ToolResultPart => ({
  type: 'tool-result',
  toolCallId: args.name,
  toolName: args.name,
  output: args.output,
})

function messageOfEvent(event: EventBody): Message | undefined {
  if (event.type === 'user-said') {
    return { role: 'user', content: [{ type: 'text', text: event.text }] }
  }

  if (event.type === 'assistant-said') {
    if (event.parts.length === 0) return undefined
    return { role: 'assistant', content: [...event.parts] }
  }

  if (event.type === 'tool-called') {
    return { role: 'assistant', content: [callPart({ name: event.name, input: event.input })] }
  }

  if (event.type === 'tool-result') {
    return {
      role: 'tool',
      content: [
        resultPart({
          name: event.name,
          output: { type: 'text', value: JSON.stringify(event.output) },
        }),
      ],
    }
  }

  if (event.type === 'tool-denied') {
    return { role: 'user', content: [{ type: 'text', text: event.reason }] }
  }

  if (event.type === 'context-loaded') {
    return { role: 'user', content: [{ type: 'text', text: event.content }] }
  }

  if (event.type === 'history-compacted') {
    return { role: 'user', content: [{ type: 'text', text: event.summary }] }
  }

  return undefined
}

/**
 * What the next turn will carry, estimated from the thread alone. It deliberately leaves out the
 * system preamble, which the harness assembles and the reader cannot see.
 */
export function estimateEventTokens(events: readonly Event[]): number {
  return events.reduce((total, event) => total + estimateBodyTokens(event), 0)
}

export function estimateBodyTokens(body: EventBody): number {
  const message = messageOfEvent(body)
  return message === undefined ? 0 : estimateMessageTokens(message)
}

/**
 * What the next request will carry, as the model itself counted it: everything it was sent plus
 * everything it just wrote. Reported usage beats the estimate because it includes the system
 * preamble and the provider's own tokenizer; until a step reports one, the estimate is all there is.
 */
export function contextTokens(args: {
  reported: ModelUsage | null
  events: readonly Event[]
}): number {
  const { reported } = args
  if (reported === null) return estimateEventTokens(args.events)
  return Math.max(0, reported.inputTokens) + Math.max(0, reported.outputTokens)
}

/**
 * The usage the last model call reported, read back from the step it wrote, so every reader of the
 * transcript sees the same number a live stream did. A compaction after it shrank the window, so
 * that reading no longer describes it.
 */
export function lastStepUsage(events: readonly Event[]): StepReading | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === 'history-compacted') return null
    if (event.type !== 'assistant-said' && event.type !== 'tool-called') continue
    if (event.usage !== undefined) return event.usage
  }
  return null
}

export const contextTokensOf = (events: readonly Event[]): number =>
  contextTokens({ reported: lastStepUsage(events), events })

export type BilledUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export const NOTHING_BILLED: BilledUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

const countedOrNothing = (value: number | undefined): number =>
  value === undefined || !Number.isFinite(value) || value < 0 ? 0 : value

/**
 * Every step is billed the whole prompt it sent, so a turn's spend is the sum over its steps —
 * unlike its context, which is only ever the last step's report.
 */
export function addUsage(args: { billed: BilledUsage; step: ModelUsage | undefined }): BilledUsage {
  const { billed, step } = args
  if (step === undefined) return billed
  return {
    inputTokens: billed.inputTokens + countedOrNothing(step.inputTokens),
    outputTokens: billed.outputTokens + countedOrNothing(step.outputTokens),
    cacheReadTokens: billed.cacheReadTokens + countedOrNothing(step.cacheReadTokens),
    cacheWriteTokens: billed.cacheWriteTokens + countedOrNothing(step.cacheWriteTokens),
  }
}
