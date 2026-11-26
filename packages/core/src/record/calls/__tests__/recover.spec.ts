import { describe, expect, it } from 'bun:test'

import { EDaemonAnswer, type CallRecordFacts, type RecoverAction } from '../index'
import { recoverCall } from '../recover'

const BOOT = 'boot-a'

const facts = (overrides: Partial<CallRecordFacts> = {}): CallRecordFacts => ({
  dispatched: true,
  dispatchedBootId: BOOT,
  resultRecorded: false,
  readOnly: false,
  ...overrides,
})

const actionOf = (args: {
  facts?: Partial<CallRecordFacts>
  answer: EDaemonAnswer | 'unavailable'
  bootId?: string
}): RecoverAction['type'] =>
  recoverCall({
    facts: facts(args.facts),
    answer: args.answer,
    bootId: args.bootId ?? BOOT,
    variant: { doneRuns: true },
  }).type

describe('the recovery table in the design, per call', () => {
  it('a recorded result is acked whatever the daemon says', () => {
    for (const answer of [EDaemonAnswer.Done, EDaemonAnswer.Running, EDaemonAnswer.NeverSeen]) {
      expect(actionOf({ facts: { resultRecorded: true }, answer })).toBe('ack')
    }
  })

  it('done on the same boot runs the body again, which collects the journaled result', () => {
    expect(actionOf({ answer: EDaemonAnswer.Done })).toBe('run')
  })

  it('running on the same boot attaches', () => {
    expect(actionOf({ answer: EDaemonAnswer.Running })).toBe('attach')
  })

  it('never-seen on the dispatch boot is the first run, so the body runs', () => {
    expect(actionOf({ answer: EDaemonAnswer.NeverSeen })).toBe('run')
  })

  it('never-seen on a different boot interrupts an effectful call once', () => {
    expect(actionOf({ answer: EDaemonAnswer.NeverSeen, bootId: 'boot-b' })).toBe('interrupted')
  })

  it('never-seen on a different boot reruns a read', () => {
    expect(
      actionOf({ facts: { readOnly: true }, answer: EDaemonAnswer.NeverSeen, bootId: 'boot-b' }),
    ).toBe('rerun')
  })

  it('an unavailable answer on the dispatch boot waits: nothing is proven, so nothing is written', () => {
    expect(actionOf({ answer: 'unavailable' })).toBe('wait')
    expect(actionOf({ facts: { readOnly: true }, answer: 'unavailable' })).toBe('wait')
    expect(
      actionOf({
        facts: { resultRecorded: false, dispatchedBootId: undefined },
        answer: 'unavailable',
      }),
    ).toBe('wait')
  })

  it('an unavailable answer on a new boot settles the call across the restart', () => {
    expect(actionOf({ answer: 'unavailable', bootId: 'boot-b' })).toBe('interrupted')
    expect(actionOf({ facts: { readOnly: true }, answer: 'unavailable', bootId: 'boot-b' })).toBe(
      'rerun',
    )
  })

  it('a call with no dispatch boot waits, even when the daemon never saw it', () => {
    expect(
      actionOf({ facts: { dispatchedBootId: undefined }, answer: EDaemonAnswer.NeverSeen }),
    ).toBe('wait')
  })

  it('a call the log never dispatched waits rather than inventing an interruption', () => {
    expect(
      actionOf({
        facts: { dispatched: false, dispatchedBootId: undefined },
        answer: EDaemonAnswer.NeverSeen,
      }),
    ).toBe('wait')
  })

  it('a known answer still decides a call with no dispatch boot', () => {
    const noBoot = { dispatchedBootId: undefined }
    expect(actionOf({ facts: noBoot, answer: EDaemonAnswer.Done })).toBe('run')
    expect(actionOf({ facts: noBoot, answer: EDaemonAnswer.Running })).toBe('attach')
  })
})
