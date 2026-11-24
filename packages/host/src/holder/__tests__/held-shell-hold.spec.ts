import { describe, expect, it } from 'bun:test'

import { OWED_ENDING_GRACE_MS, UNCOUNTED_SHELL_HOLD_MS, shellHoldOf } from '../held-shells'

const NOW = 1_000_000

describe('shellHoldOf', () => {
  it('holds for every shell the pod still runs', () => {
    expect(shellHoldOf({ counted: 2, openInLog: 1, owedSince: undefined, now: NOW })).toEqual({
      holding: 2,
      owedSince: undefined,
    })
  })

  it('holds while a shell that exited on the pod has no ending in the log yet', () => {
    expect(shellHoldOf({ counted: 0, openInLog: 1, owedSince: undefined, now: NOW })).toEqual({
      holding: 1,
      owedSince: NOW,
    })
  })

  it('stops holding for an owed ending once the grace has passed', () => {
    const owedSince = NOW - OWED_ENDING_GRACE_MS
    expect(shellHoldOf({ counted: 0, openInLog: 1, owedSince, now: NOW })).toEqual({
      holding: 0,
      owedSince,
    })
  })

  it('forgets the owed clock once the log has every ending', () => {
    expect(shellHoldOf({ counted: 0, openInLog: 0, owedSince: NOW - 5, now: NOW })).toEqual({
      holding: 0,
      owedSince: undefined,
    })
  })

  it('holds every shell open in the log when the pod cannot be counted', () => {
    expect(
      shellHoldOf({ counted: undefined, openInLog: 2, owedSince: undefined, now: NOW }),
    ).toEqual({ holding: 2, owedSince: NOW })
  })

  it('keeps holding an uncounted pod past the owed-ending grace', () => {
    const owedSince = NOW - OWED_ENDING_GRACE_MS
    expect(shellHoldOf({ counted: undefined, openInLog: 1, owedSince, now: NOW })).toEqual({
      holding: 1,
      owedSince,
    })
  })

  it('stops holding a pod that stayed uncounted past the cap', () => {
    const owedSince = NOW - UNCOUNTED_SHELL_HOLD_MS
    expect(shellHoldOf({ counted: undefined, openInLog: 1, owedSince, now: NOW })).toEqual({
      holding: 0,
      owedSince,
    })
  })

  it('holds nothing when the pod cannot be counted and the log has no open shell', () => {
    expect(shellHoldOf({ counted: undefined, openInLog: 0, owedSince: NOW, now: NOW })).toEqual({
      holding: 0,
      owedSince: undefined,
    })
  })
})
