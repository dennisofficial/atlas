import { describe, expect, it } from 'bun:test'

import { toCallId } from '@dltech/atlas-core'

import { stepsOfSignalsAt } from '../in-flight-steps'
import {
  started,
  stepOne,
  textDelta,
  toolCall,
  toolInputDelta,
  toolInputEnd,
  toolInputStart,
} from './fixture'

const OPENED_AT = new Date('2026-03-04T05:06:07.000Z')

const callsOf = (signals: Parameters<typeof stepsOfSignalsAt>[0]['signals']) =>
  stepsOfSignalsAt({ signals, now: () => OPENED_AT }).at(0)?.calls ?? []

describe('a tool call the model is still dictating', () => {
  it('names the call as soon as the model reaches for the tool', () => {
    const calls = callsOf([
      started(stepOne),
      textDelta({ stepId: stepOne, blockId: 'b1', text: 'Let me write the synthesis.' }),
      toolInputStart({ stepId: stepOne, callId: 'call-1', name: 'write_file' }),
    ])

    expect(calls).toEqual([
      {
        callId: toCallId('call-1'),
        name: 'write_file',
        input: undefined,
        at: OPENED_AT.toISOString(),
        precededByBlocks: 1,
      },
    ])
  })

  it('shows the arguments growing, so the file is readable before it is written', () => {
    const signals = [
      started(stepOne),
      toolInputStart({ stepId: stepOne, callId: 'call-1', name: 'write_file' }),
      toolInputDelta({ stepId: stepOne, callId: 'call-1', text: '{"path":"notes.md",' }),
    ]

    expect(callsOf(signals).at(0)?.input).toEqual({ path: 'notes.md' })

    expect(
      callsOf([
        ...signals,
        toolInputDelta({ stepId: stepOne, callId: 'call-1', text: '"content":"# Is the ver' }),
      ]).at(0)?.input,
    ).toEqual({ path: 'notes.md', content: '# Is the ver' })
  })

  it('takes the assembled input over the pieces once the call is whole', () => {
    const calls = callsOf([
      started(stepOne),
      toolInputStart({ stepId: stepOne, callId: 'call-1', name: 'write_file' }),
      toolInputDelta({
        stepId: stepOne,
        callId: 'call-1',
        text: '{"path":"notes.md","content":"a',
      }),
      toolInputEnd({ stepId: stepOne, callId: 'call-1' }),
      toolCall({
        stepId: stepOne,
        callId: 'call-1',
        name: 'write_file',
        input: { path: 'notes.md', content: 'ab' },
      }),
    ])

    expect(calls).toEqual([
      {
        callId: toCallId('call-1'),
        name: 'write_file',
        input: { path: 'notes.md', content: 'ab' },
        at: OPENED_AT.toISOString(),
        precededByBlocks: 0,
      },
    ])
  })

  it('records one call when a provider streams no pieces at all', () => {
    const calls = callsOf([
      started(stepOne),
      toolCall({ stepId: stepOne, callId: 'call-1', name: 'read_file', input: { path: 'a' } }),
    ])

    expect(calls.map((call) => call.callId)).toEqual([toCallId('call-1')])
    expect(calls.at(0)?.input).toEqual({ path: 'a' })
  })

  it('stamps when the call opened, so the transcript can count up while it runs', () => {
    const calls = callsOf([
      started(stepOne),
      toolInputStart({ stepId: stepOne, callId: 'call-1', name: 'bash' }),
    ])

    expect(calls.at(0)?.at).toBe('2026-03-04T05:06:07.000Z')
  })

  it('leaves the call unstamped when no clock is given, so the projection stays deterministic', () => {
    const steps = stepsOfSignalsAt({
      signals: [
        started(stepOne),
        toolInputStart({ stepId: stepOne, callId: 'call-1', name: 'bash' }),
      ],
      now: undefined,
    })

    expect(steps.at(0)?.calls.at(0)?.at).toBeNull()
  })

  it('keeps parallel calls apart while both are being dictated', () => {
    const calls = callsOf([
      started(stepOne),
      toolInputStart({ stepId: stepOne, callId: 'call-1', name: 'read_file' }),
      toolInputStart({ stepId: stepOne, callId: 'call-2', name: 'read_file' }),
      toolInputDelta({ stepId: stepOne, callId: 'call-1', text: '{"path":"a' }),
      toolInputDelta({ stepId: stepOne, callId: 'call-2', text: '{"path":"b' }),
    ])

    expect(calls.map((call) => call.input)).toEqual([{ path: 'a' }, { path: 'b' }])
  })
})
