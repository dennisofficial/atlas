import { describe, expect, it } from 'bun:test'

import { EDaemonAnswer } from '../call-states'
import { recoverCall, type CallRecordFacts, type RecoverAction } from '../recover'

const facts = (patch: Partial<CallRecordFacts> = {}): CallRecordFacts => ({
  dispatched: true,
  dispatchedBootId: 'boot-a',
  resultRecorded: false,
  readOnly: false,
  ...patch,
})

const decide = (args: {
  patch?: Partial<CallRecordFacts>
  answer: EDaemonAnswer | 'unavailable'
  bootId?: string
}): RecoverAction =>
  recoverCall({
    facts: facts(args.patch),
    answer: args.answer,
    bootId: args.bootId ?? 'boot-a',
  })

describe('recoverCall', () => {
  it('acks a call whose result is already recorded', () => {
    expect(decide({ patch: { resultRecorded: true }, answer: EDaemonAnswer.Done })).toEqual({
      type: 'ack',
    })
  })

  it('records the result the daemon already holds', () => {
    expect(decide({ answer: EDaemonAnswer.Done })).toEqual({ type: 'record-result' })
  })

  it('attaches to a running step', () => {
    expect(decide({ answer: EDaemonAnswer.Running })).toEqual({ type: 'attach' })
  })

  it('runs a step the same boot never saw', () => {
    expect(decide({ answer: EDaemonAnswer.NeverSeen })).toEqual({ type: 'run' })
  })

  it('interrupts a step a different boot never saw', () => {
    expect(decide({ answer: EDaemonAnswer.NeverSeen, bootId: 'boot-b' })).toEqual({
      type: 'interrupted',
    })
  })

  it('reruns a read a different boot never saw', () => {
    expect(
      decide({ patch: { readOnly: true }, answer: EDaemonAnswer.NeverSeen, bootId: 'boot-b' }),
    ).toEqual({ type: 'rerun' })
  })

  it('waits when the daemon did not answer and the boot is unchanged', () => {
    expect(decide({ answer: 'unavailable' })).toEqual({ type: 'wait' })
  })

  it('interrupts when the daemon did not answer but the pod proves a new boot', () => {
    expect(decide({ answer: 'unavailable', bootId: 'boot-b' })).toEqual({ type: 'interrupted' })
  })

  it('waits when no dispatch recorded a boot', () => {
    expect(
      decide({ patch: { dispatchedBootId: undefined }, answer: EDaemonAnswer.NeverSeen }),
    ).toEqual({ type: 'wait' })
    expect(decide({ patch: { dispatched: false }, answer: EDaemonAnswer.NeverSeen })).toEqual({
      type: 'wait',
    })
  })
})
