import { describe, expect, it } from 'bun:test'

import { toCallId, toEventId } from '@dltech/atlas-core'

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
  toolInputStart,
} from '../../transcript/__tests__/fixture'
import { stepsOfSignalsAt } from '../../transcript/in-flight-steps'
import { stepsOfMessages } from '../step-messages'
import { createTestChat, FIXED_NOW } from './test-chat'

const stepIdOf = (signal: StepSignal): string | null => ('stepId' in signal ? signal.stepId : null)

async function chatSteps(signals: readonly StepSignal[]) {
  const { chat, signals: transport } = createTestChat()
  for (const signal of signals) transport.absorb(signal)
  const stepCount = new Set(signals.map(stepIdOf).filter((id) => id !== null)).size
  for (let claimed = 0; claimed < stepCount; claimed += 1) await chat.resumeStream()
  return stepsOfMessages(chat.messages)
}

const shape = (steps: ReturnType<typeof stepsOfMessages>) =>
  steps.map((step) => ({
    stepId: step.stepId,
    blocks: step.blocks.map(({ kind, text }) => ({ kind, text })),
    calls: step.calls,
    end: step.end,
    supersededBy: step.supersededBy,
    errorMessage: step.errorMessage,
  }))

describe('stepsOfMessages', () => {
  it('matches the signal accumulation for a full multi-step exchange', async () => {
    const superseding = { eventId: toEventId('event-9'), seq: 9 }
    const signals: StepSignal[] = [
      started(stepOne),
      reasoningDelta({ stepId: stepOne, blockId: 'r1', text: 'think' }),
      textDelta({ stepId: stepOne, blockId: 'b1', text: 'Let me look.' }),
      toolInputStart({ stepId: stepOne, callId: 'call-1', name: 'read_file' }),
      toolInputDelta({ stepId: stepOne, callId: 'call-1', text: '{"path":"a' }),
      toolCall({
        stepId: stepOne,
        callId: 'call-1',
        name: 'read_file',
        input: { path: 'a' },
      }),
      toolCall({
        stepId: stepOne,
        callId: 'call-2',
        name: 'bash',
        input: { cmd: 'ls' },
      }),
      ended({ stepId: stepOne, end: EStepEnd.Completed, supersededBy: null }),
      started(stepTwo),
      textDelta({ stepId: stepTwo, blockId: 'b1', text: 'Found it.' }),
      {
        type: 'chunk',
        stepId: stepTwo,
        chunk: { type: 'error', message: 'boom' },
      },
      ended({
        stepId: stepTwo,
        end: EStepEnd.Failed,
        supersededBy: superseding,
      }),
    ]

    const fromSignals = stepsOfSignalsAt({ signals, now: () => FIXED_NOW })
    const fromChat = await chatSteps(signals)

    expect(shape(fromChat)).toEqual(shape(fromSignals))
  })

  it('reads the partial input of a call that is still being dictated', async () => {
    const { chat, signals } = createTestChat()
    signals.absorb(started(stepOne))
    signals.absorb(toolInputStart({ stepId: stepOne, callId: 'call-1', name: 'write_file' }))
    signals.absorb(
      toolInputDelta({
        stepId: stepOne,
        callId: 'call-1',
        text: '{"path":"a.ts"',
      }),
    )
    void chat.resumeStream()
    await Bun.sleep(0)

    const [step] = stepsOfMessages(chat.messages)

    expect(step?.end).toBeNull()
    expect(step?.calls).toEqual([
      {
        callId: toCallId('call-1'),
        name: 'write_file',
        input: { path: 'a.ts' },
        at: FIXED_NOW.toISOString(),
        precededByBlocks: 0,
      },
    ])
  })

  it('gives blocks stable ids across renders as text grows', async () => {
    const { chat, signals } = createTestChat()
    signals.absorb(started(stepOne))
    signals.absorb(textDelta({ stepId: stepOne, blockId: 'b1', text: 'a' }))
    void chat.resumeStream()
    await Bun.sleep(0)
    const before = stepsOfMessages(chat.messages)[0]?.blocks[0]?.id

    signals.absorb(textDelta({ stepId: stepOne, blockId: 'b1', text: 'bc' }))
    await Bun.sleep(0)
    const after = stepsOfMessages(chat.messages)[0]?.blocks[0]

    expect(after?.text).toBe('abc')
    expect(after?.id).toBe(before ?? '')
  })

  it('counts only text and reasoning parts as preceding a call', async () => {
    const signals: StepSignal[] = [
      started(stepOne),
      textDelta({ stepId: stepOne, blockId: 'b1', text: 'x' }),
      toolCall({ stepId: stepOne, callId: 'call-1', name: 'bash', input: {} }),
      textDelta({ stepId: stepOne, blockId: 'b2', text: 'y' }),
      toolCall({ stepId: stepOne, callId: 'call-2', name: 'bash', input: {} }),
      ended({ stepId: stepOne, end: EStepEnd.Completed, supersededBy: null }),
    ]

    const [step] = await chatSteps(signals)

    expect(step?.calls.map((call) => call.precededByBlocks)).toEqual([1, 2])
  })
})
