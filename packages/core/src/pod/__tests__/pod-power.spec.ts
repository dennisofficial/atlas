import { describe, expect, it } from 'bun:test'

import { EPodPowerPhase, podPowerOf, type PodPowerFacts } from '../pod-power'

const PARKED_AT = '2026-11-26T10:00:00.000Z'

const factsOf = (over: Partial<PodPowerFacts>): PodPowerFacts => ({
  parkedAt: null,
  parkError: null,
  sandboxStatus: undefined,
  sandboxStatusAt: undefined,
  live: true,
  wantsHolder: false,
  ...over,
})

describe('podPowerOf', () => {
  it('fails on a park error, naming the park it failed', () => {
    expect(
      podPowerOf(
        factsOf({ parkedAt: PARKED_AT, parkError: 'sleep failed', sandboxStatus: 'sleeping' }),
      ),
    ).toEqual({ phase: EPodPowerPhase.Failed, error: 'sleep failed', since: PARKED_AT })
  })

  it('reports a park error with no park record as failed with no since', () => {
    expect(podPowerOf(factsOf({ parkError: 'sleep failed' }))).toEqual({
      phase: EPodPowerPhase.Failed,
      error: 'sleep failed',
    })
  })

  it.each(['sleeping', 'stopped'])(
    'reports a parked pod as asleep once the sandbox is %s',
    (status) => {
      expect(podPowerOf(factsOf({ parkedAt: PARKED_AT, sandboxStatus: status }))).toEqual({
        phase: EPodPowerPhase.Asleep,
      })
    },
  )

  it('reports a parked pod whose sandbox woke after the park as steady', () => {
    expect(
      podPowerOf(
        factsOf({
          parkedAt: PARKED_AT,
          sandboxStatus: 'running',
          sandboxStatusAt: '2026-11-26T10:00:01.000Z',
        }),
      ),
    ).toEqual({ phase: EPodPowerPhase.Steady })
  })

  it.each([
    ['before the park', '2026-11-26T09:59:59.000Z'],
    ['at the park', PARKED_AT],
  ])('keeps a parked pod stopping while the sandbox status is %s', (_name, at) => {
    expect(
      podPowerOf(factsOf({ parkedAt: PARKED_AT, sandboxStatus: 'running', sandboxStatusAt: at })),
    ).toEqual({ phase: EPodPowerPhase.Stopping, since: PARKED_AT })
  })

  it('keeps a parked pod stopping while the sandbox has no status', () => {
    expect(podPowerOf(factsOf({ parkedAt: PARKED_AT }))).toEqual({
      phase: EPodPowerPhase.Stopping,
      since: PARKED_AT,
    })
  })

  it.each(['waking', 'starting', 'restarting', 'provisioning'])(
    'reports an unparked pod as starting while the sandbox is %s',
    (status) => {
      expect(podPowerOf(factsOf({ sandboxStatus: status }))).toEqual({
        phase: EPodPowerPhase.Starting,
      })
    },
  )

  it('keeps an unparked asleep sandbox asleep when nobody wants a holder', () => {
    expect(podPowerOf(factsOf({ sandboxStatus: 'sleeping' }))).toEqual({
      phase: EPodPowerPhase.Asleep,
    })
  })

  it('starts an unparked asleep sandbox once a holder is wanted', () => {
    expect(podPowerOf(factsOf({ sandboxStatus: 'sleeping', wantsHolder: true }))).toEqual({
      phase: EPodPowerPhase.Starting,
    })
  })

  it('reports a live session without a sandbox status as steady', () => {
    expect(podPowerOf(factsOf({ live: true }))).toEqual({ phase: EPodPowerPhase.Steady })
  })

  it.each([true, false])(
    'reports an unheld session without a sandbox status as starting when wantsHolder is %s',
    (wantsHolder) => {
      expect(podPowerOf(factsOf({ live: false, wantsHolder }))).toEqual({
        phase: wantsHolder ? EPodPowerPhase.Starting : EPodPowerPhase.Asleep,
      })
    },
  )

  it('reports an unparked running sandbox as steady', () => {
    expect(podPowerOf(factsOf({ sandboxStatus: 'running', sandboxStatusAt: PARKED_AT }))).toEqual({
      phase: EPodPowerPhase.Steady,
    })
  })

  it('reports an unparked stopping sandbox as steady', () => {
    expect(podPowerOf(factsOf({ sandboxStatus: 'stopping' }))).toEqual({
      phase: EPodPowerPhase.Steady,
    })
  })
})
