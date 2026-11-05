import { describe, expect, it } from 'bun:test'

import { EStepEndReason, saidBody, toRunId, type Chunk, type ChunkFilter } from '@dltech/atlas-core'

import { rigOf, THREAD } from '../../__tests__/exit-fixture'
import type { AgentOutputEvent, StepStreamEvent } from '../agent-output'

const STREAM_TYPES = new Set(['step-start', 'chunk', 'step-end'])

const capture = () => {
  const events: StepStreamEvent[] = []
  const output = {
    emit: (event: AgentOutputEvent) => {
      if (STREAM_TYPES.has(event.type)) events.push(event as StepStreamEvent)
    },
  }
  return { events, output }
}

const textOf = (events: readonly StepStreamEvent[]): string =>
  events
    .flatMap((event) =>
      event.type === 'chunk' && event.chunk.type === 'text-delta' ? [event.chunk.text] : [],
    )
    .join('')

const turnWith = async (args: {
  script: Parameters<typeof rigOf>[0]['script']
  onChunk?: ChunkFilter
}) => {
  const seen = capture()
  const rig = rigOf({
    script: args.script,
    overrides: {
      output: seen.output,
      ...(args.onChunk === undefined ? {} : { onChunk: args.onChunk }),
    },
  })
  await rig.record.append({
    threadId: THREAD,
    runId: toRunId('run-seed'),
    drafts: [saidBody({ text: 'hi' })],
  })
  await rig.runner.runTurn({ threadId: THREAD })
  return seen.events
}

describe('streamed chunks', () => {
  it('brackets a streamed step with step-start and step-end and emits its text', async () => {
    const events = await turnWith({ script: [{ text: 'hello streaming world', streamMs: 8 }] })
    const types = events.map((event) => event.type)
    expect(types[0]).toBe('step-start')
    expect(types.at(-1)).toBe('step-end')
    expect(textOf(events)).toBe('hello streaming world')
    const end = events.at(-1)
    expect(end?.type === 'step-end' && end.reason).toBe(EStepEndReason.Finished)
    const keys = new Set(events.map((event) => JSON.stringify(event.key)))
    expect(keys.size).toBe(1)
  })

  it('never emits a chunk the hook dropped', async () => {
    const events = await turnWith({
      script: [{ text: 'abXcd', streamMs: 8 }],
      onChunk: (chunk) => (chunk.type === 'text-delta' && chunk.text === 'X' ? null : chunk),
    })
    expect(textOf(events)).toBe('abcd')
  })

  it('emits the text a hook rewrote', async () => {
    const events = await turnWith({
      script: [{ text: 'abcdef', streamMs: 8 }],
      onChunk: (chunk: Chunk) =>
        chunk.type === 'text-delta' ? { ...chunk, text: chunk.text.toUpperCase() } : chunk,
    })
    expect(textOf(events)).toBe('ABCDEF')
  })

  it('numbers attempts from zero and closes a failed attempt as aborted', async () => {
    const events = await turnWith({
      script: [{ throws: new Error('connection reset') }, { text: 'second try', streamMs: 8 }],
    })
    const starts = events.filter((event) => event.type === 'step-start')
    expect(starts.map((event) => event.key.attempt)).toEqual([0, 1])
    const ends = events.filter((event) => event.type === 'step-end')
    expect(ends.map((event) => (event.type === 'step-end' ? event.reason : undefined))).toEqual([
      EStepEndReason.Aborted,
      EStepEndReason.Finished,
    ])
    expect(textOf(events.filter((event) => event.key.attempt === 1))).toBe('second try')
  })
})
