import { describe, expect, it } from 'bun:test'

import {
  clearAttemptsIfEpoch,
  crashLooped,
  MAX_START_ATTEMPTS,
  revoke,
  revokeIfEpoch,
  startVerdict,
} from '../lease'
import { lease } from './support'

const RETRY_AT = '2026-11-02T12:00:08.000Z'

describe('startVerdict', () => {
  it('gives up at the fifth claim and not before', () => {
    expect(MAX_START_ATTEMPTS).toBe(5)
    expect(startVerdict({ attempts: 4, permanent: false })).toEqual({
      permanent: false,
      giveUp: false,
    })
    expect(startVerdict({ attempts: 5, permanent: false })).toEqual({
      permanent: false,
      giveUp: true,
    })
    expect(startVerdict({ attempts: 9, permanent: false })).toEqual({
      permanent: false,
      giveUp: true,
    })
  })

  it('gives up at once on a permanent failure', () => {
    expect(startVerdict({ attempts: 1, permanent: true })).toEqual({
      permanent: true,
      giveUp: true,
    })
  })
})

describe('crashLooped', () => {
  it('is true from the sixth claim without a clean settle', () => {
    expect(crashLooped(lease({ attempts: MAX_START_ATTEMPTS }))).toBe(false)
    expect(crashLooped(lease({ attempts: MAX_START_ATTEMPTS + 1 }))).toBe(true)
  })
})

describe('revoke retry state', () => {
  const retrying = lease({ attempts: 3, retryAfter: RETRY_AT })

  it('keeps attempts and retryAfter by default', () => {
    expect(revoke({ lease: retrying, wantsHolder: true })).toMatchObject({
      attempts: 3,
      retryAfter: RETRY_AT,
    })
  })

  it('clears attempts and retryAfter when resetRetry is set', () => {
    expect(revoke({ lease: retrying, wantsHolder: true, resetRetry: true })).toMatchObject({
      holderHostId: null,
      wantsHolder: true,
      attempts: 0,
      retryAfter: null,
    })
  })

  it('revokeIfEpoch clears the retry state only for the matching epoch', () => {
    expect(
      revokeIfEpoch({ lease: retrying, wantsHolder: false, epoch: 3, resetRetry: true }),
    ).toMatchObject({ ok: true, lease: { attempts: 0, retryAfter: null } })
    expect(
      revokeIfEpoch({ lease: retrying, wantsHolder: false, epoch: 2, resetRetry: true }),
    ).toEqual({ ok: false, refusal: { kind: 'stale-epoch', current: 3 } })
    expect(revokeIfEpoch({ lease: retrying, wantsHolder: false, epoch: 3 })).toMatchObject({
      ok: true,
      lease: { attempts: 3, retryAfter: RETRY_AT },
    })
  })
})

describe('clearAttemptsIfEpoch', () => {
  const retrying = lease({ attempts: 3, retryAfter: RETRY_AT, epoch: 4, holderHostId: 7 })

  it('forgets the failed starts of the holder that owns the epoch', () => {
    expect(clearAttemptsIfEpoch({ lease: retrying, epoch: 4 })).toMatchObject({
      ok: true,
      lease: { epoch: 4, holderHostId: 7, attempts: 0, retryAfter: null },
    })
  })

  it('changes nothing for a stale epoch', () => {
    expect(clearAttemptsIfEpoch({ lease: retrying, epoch: 5 })).toEqual({
      ok: false,
      refusal: { kind: 'stale-epoch', current: 4 },
    })
  })
})
