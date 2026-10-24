import { describe, expect, it } from 'bun:test'

import { EFinishReason, toCallId } from '@dltech/atlas-core'

import { EStepEnd, type StepSignal } from '../../channel'
import {
  ended,
  reasoningDelta,
  started,
  stepOne,
  stepTwo,
  textDelta,
  toolCall,
  toolInputDelta,
  toolInputEnd,
  toolInputStart,
} from '../../transcript/__tests__/fixture'
import { createStepChunker } from '../step-chunks'
import { FIXED_NOW } from './test-chat'

const chunksOf = (signals: readonly StepSignal[]) => {
  const chunker = createStepChunker({ now: () => FIXED_NOW })
  return signals.flatMap((signal) => chunker.chunksOf(signal))
}

const FRESH_METADATA = {
  stepId: stepOne,
  end: null,
  supersededBy: null,
  errorMessage: null,
  callsAt: {},
}

describe('the step chunker', () => {
  it('opens a message keyed by the step id when the step starts', () => {
    expect(chunksOf([started(stepOne)])).toEqual([
      { type: 'start', messageId: stepOne, messageMetadata: FRESH_METADATA },
      { type: 'start-step' },
    ])
  })

  it('renames the text delta field and opens the block on its first delta', () => {
    const chunks = chunksOf([
      started(stepOne),
      textDelta({ stepId: stepOne, blockId: 'b1', text: 'Hel' }),
      textDelta({ stepId: stepOne, blockId: 'b1', text: 'lo' }),
    ])

    expect(chunks.slice(2)).toEqual([
      { type: 'text-start', id: 'b1' },
      { type: 'text-delta', id: 'b1', delta: 'Hel' },
      { type: 'text-delta', id: 'b1', delta: 'lo' },
    ])
  })

  it('keeps a text block and a reasoning block of the same id apart', () => {
    const chunks = chunksOf([
      started(stepOne),
      reasoningDelta({ stepId: stepOne, blockId: 'b1', text: 'hm' }),
      textDelta({ stepId: stepOne, blockId: 'b1', text: 'ok' }),
    ])

    expect(chunks.slice(2).map((chunk) => chunk.type)).toEqual([
      'reasoning-start',
      'reasoning-delta',
      'text-start',
      'text-delta',
    ])
  })

  it('passes explicit block starts and ends through once', () => {
    const chunks = chunksOf([
      started(stepOne),
      {
        type: 'chunk',
        stepId: stepOne,
        chunk: { type: 'text-start', id: 'b1' },
      },
      textDelta({ stepId: stepOne, blockId: 'b1', text: 'a' }),
      { type: 'chunk', stepId: stepOne, chunk: { type: 'text-end', id: 'b1' } },
    ])

    expect(chunks.slice(2).map((chunk) => chunk.type)).toEqual([
      'text-start',
      'text-delta',
      'text-end',
    ])
  })

  it('stamps when a tool call opened in the message metadata', () => {
    const chunks = chunksOf([
      started(stepOne),
      toolInputStart({ stepId: stepOne, callId: 'call-1', name: 'bash' }),
    ])

    expect(chunks.slice(2)).toEqual([
      {
        type: 'tool-input-start',
        toolCallId: 'call-1',
        toolName: 'bash',
        dynamic: true,
      },
      {
        type: 'message-metadata',
        messageMetadata: { callsAt: { 'call-1': FIXED_NOW.toISOString() } },
      },
    ])
  })

  it('renames the tool input delta and drops the input end', () => {
    const chunks = chunksOf([
      started(stepOne),
      toolInputStart({ stepId: stepOne, callId: 'call-1', name: 'bash' }),
      toolInputDelta({ stepId: stepOne, callId: 'call-1', text: '{"a' }),
      toolInputEnd({ stepId: stepOne, callId: 'call-1' }),
    ])

    expect(chunks.slice(4)).toEqual([
      { type: 'tool-input-delta', toolCallId: 'call-1', inputTextDelta: '{"a' },
    ])
  })

  it('ignores input for a call it never saw start', () => {
    const chunks = chunksOf([
      started(stepOne),
      toolInputDelta({ stepId: stepOne, callId: 'ghost', text: '{' }),
    ])

    expect(chunks).toHaveLength(2)
  })

  it('maps a settled tool call to input-available', () => {
    const chunks = chunksOf([
      started(stepOne),
      toolInputStart({ stepId: stepOne, callId: 'call-1', name: 'bash' }),
      toolCall({
        stepId: stepOne,
        callId: 'call-1',
        name: 'bash',
        input: { cmd: 'ls' },
      }),
    ])

    expect(chunks.slice(4)).toEqual([
      {
        type: 'tool-input-available',
        toolCallId: 'call-1',
        toolName: 'bash',
        input: { cmd: 'ls' },
        dynamic: true,
      },
    ])
  })

  it('opens the call first when a tool call arrives without a start', () => {
    const chunks = chunksOf([
      started(stepOne),
      toolCall({ stepId: stepOne, callId: 'call-1', name: 'bash', input: {} }),
    ])

    expect(chunks.slice(2).map((chunk) => chunk.type)).toEqual([
      'tool-input-start',
      'message-metadata',
      'tool-input-available',
    ])
  })

  it('emits nothing for the model finish, since the step end closes the message', () => {
    const chunks = chunksOf([
      started(stepOne),
      {
        type: 'chunk',
        stepId: stepOne,
        chunk: { type: 'finish', reason: EFinishReason.Stop },
      },
    ])

    expect(chunks).toHaveLength(2)
  })

  it('records a model error as metadata, never as an SDK error chunk', () => {
    const chunks = chunksOf([
      started(stepOne),
      {
        type: 'chunk',
        stepId: stepOne,
        chunk: { type: 'error', message: 'overloaded' },
      },
    ])

    expect(chunks.slice(2)).toEqual([
      {
        type: 'message-metadata',
        messageMetadata: { errorMessage: 'overloaded' },
      },
    ])
    expect(chunks.some((chunk) => chunk.type === 'error')).toBe(false)
  })

  it('closes the message with the step end and what superseded it', () => {
    const chunks = chunksOf([
      started(stepOne),
      ended({ stepId: stepOne, end: EStepEnd.Completed, supersededBy: null }),
    ])

    expect(chunks.slice(2)).toEqual([
      {
        type: 'message-metadata',
        messageMetadata: { end: EStepEnd.Completed, supersededBy: null },
      },
      { type: 'finish-step' },
      { type: 'finish' },
    ])
  })

  it('ends blocks still open when the step ends', () => {
    const chunks = chunksOf([
      started(stepOne),
      reasoningDelta({ stepId: stepOne, blockId: 'r1', text: 'hm' }),
      textDelta({ stepId: stepOne, blockId: 'b1', text: 'a' }),
      ended({ stepId: stepOne, end: EStepEnd.Interrupted, supersededBy: null }),
    ])

    expect(chunks.slice(-5, -3)).toEqual([
      { type: 'reasoning-end', id: 'r1' },
      { type: 'text-end', id: 'b1' },
    ])
  })

  it('ignores turn-working and tool-output, which belong outside any step', () => {
    expect(
      chunksOf([
        { type: 'turn-working', working: true },
        { type: 'tool-output', callId: toCallId('call-1'), text: 'out' },
      ]),
    ).toEqual([])
  })

  it('opens a message for a chunk whose step start it never saw', () => {
    const chunks = chunksOf([textDelta({ stepId: stepTwo, blockId: 'b1', text: 'x' })])

    expect(chunks.slice(0, 2).map((chunk) => chunk.type)).toEqual(['start', 'start-step'])
    expect(chunks[0]).toMatchObject({ messageId: stepTwo })
  })

  it('ignores the end of a step that is not the open one', () => {
    const chunks = chunksOf([
      started(stepOne),
      ended({ stepId: stepTwo, end: EStepEnd.Completed, supersededBy: null }),
    ])

    expect(chunks).toHaveLength(2)
  })
})
