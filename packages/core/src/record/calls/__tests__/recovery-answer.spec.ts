import { describe, expect, it } from 'bun:test'

import { EDaemonAnswer, recoverCall } from '..'

const facts = {
  dispatched: true,
  dispatchedBootId: 'boot-a',
  resultRecorded: false,
  readOnly: false,
}

describe('recoverCall with a daemon that cannot answer', () => {
  it('waits instead of inventing a restart, on the same boot', () => {
    expect(recoverCall({ facts, answer: 'unavailable', bootId: 'boot-a' }).type).toBe('wait')
  })

  it('waits instead of inventing a restart, on a changed boot', () => {
    expect(recoverCall({ facts, answer: 'unavailable', bootId: 'boot-b' }).type).toBe('wait')
  })

  it('waits even when a result was never recorded and the call is read only', () => {
    expect(
      recoverCall({
        facts: { ...facts, readOnly: true },
        answer: 'unavailable',
        bootId: 'boot-b',
      }).type,
    ).toBe('wait')
  })

  it('still acks a recorded result it cannot ask about', () => {
    expect(
      recoverCall({
        facts: { ...facts, resultRecorded: true },
        answer: 'unavailable',
        bootId: 'boot-a',
      }).type,
    ).toBe('ack')
  })
})

describe('recoverCall with an answered daemon', () => {
  it('runs a call the same boot never saw, because that is its first run', () => {
    expect(recoverCall({ facts, answer: EDaemonAnswer.NeverSeen, bootId: 'boot-a' }).type).toBe(
      'run',
    )
  })

  it('interrupts a call a new boot never saw', () => {
    expect(recoverCall({ facts, answer: EDaemonAnswer.NeverSeen, bootId: 'boot-b' }).type).toBe(
      'interrupted',
    )
  })

  it('attaches to a running call and records a finished one', () => {
    expect(recoverCall({ facts, answer: EDaemonAnswer.Running, bootId: 'boot-a' }).type).toBe(
      'attach',
    )
    expect(recoverCall({ facts, answer: EDaemonAnswer.Done, bootId: 'boot-a' }).type).toBe(
      'record-result',
    )
    expect(
      recoverCall({
        facts,
        answer: EDaemonAnswer.Done,
        bootId: 'boot-a',
        variant: { doneRuns: true },
      }).type,
    ).toBe('run')
  })
})
