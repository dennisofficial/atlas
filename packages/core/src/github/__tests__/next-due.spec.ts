import { describe, expect, it } from 'bun:test'
import {
  ETargetKind,
  ETargetOutcome,
  ETrackingTransport,
  TRACKING_BACKOFF_BASE_MS,
  TRACKING_BACKOFF_MAX_MS,
  TRACKING_COVERED_RECHECK_MS,
  TRACKING_MERGED_SETTLE_WINDOW_MS,
  TRACKING_POLLED_HEAD_MS,
  TRACKING_POLLED_PULL_MS,
  TRACKING_REFUSAL_RETRY_MS,
  nextDueOf,
} from '../next-due'

const NOW = Date.parse('2026-11-18T12:00:00Z')
const LIVE_UNTIL = NOW + 6 * 60 * 60 * 1_000

const base = {
  nowMs: NOW,
  kind: ETargetKind.PullRequest,
  transport: ETrackingTransport.Polled,
  lookedUp: true,
  failures: 0,
  liveUntilMs: LIVE_UNTIL,
}

type DueArgs = Parameters<typeof nextDueOf>[0]
const due = (over: Partial<DueArgs> & Pick<DueArgs, 'outcome'>) => nextDueOf({ ...base, ...over })

describe('nextDueOf', () => {
  it('parks a settled target at liveUntil without touching failures', () => {
    expect(due({ outcome: ETargetOutcome.TerminalSettled, failures: 3 })).toEqual({
      nextDueAt: LIVE_UNTIL,
      failures: 3,
    })
  })

  it('parks a budget refusal at the refusal and leaves failures unchanged', () => {
    expect(
      due({
        outcome: ETargetOutcome.BudgetRefused,
        failures: 2,
        retryAtMs: NOW + 4_000,
      }),
    ).toEqual({ nextDueAt: NOW + 4_000, failures: 2 })
  })

  it('retries a refusal without a time in a minute, still not charging failures', () => {
    expect(due({ outcome: ETargetOutcome.CredentialLimited, failures: 1 })).toEqual({
      nextDueAt: NOW + TRACKING_REFUSAL_RETRY_MS,
      failures: 1,
    })
  })

  it('backs a failure off exponentially from its failure count', () => {
    expect(due({ outcome: ETargetOutcome.Failed, failures: 0 })).toEqual({
      nextDueAt: NOW + TRACKING_BACKOFF_BASE_MS,
      failures: 1,
    })
    expect(due({ outcome: ETargetOutcome.NotFound, failures: 3 })).toEqual({
      nextDueAt: NOW + TRACKING_BACKOFF_BASE_MS * 8,
      failures: 4,
    })
  })

  it('caps the backoff at fifteen minutes and at liveUntil', () => {
    expect(due({ outcome: ETargetOutcome.Failed, failures: 10 })).toEqual({
      nextDueAt: NOW + TRACKING_BACKOFF_MAX_MS,
      failures: 11,
    })
    expect(
      due({ outcome: ETargetOutcome.Failed, failures: 10, liveUntilMs: NOW + 60_000 }),
    ).toEqual({ nextDueAt: NOW + 60_000, failures: 11 })
  })

  it('rechecks a covered head on coverage alone, spending no GitHub call', () => {
    for (const transport of [ETrackingTransport.AppWebhook, ETrackingTransport.UserWebhook]) {
      expect(due({ outcome: ETargetOutcome.Polled, transport, failures: 4 })).toEqual({
        nextDueAt: NOW + TRACKING_COVERED_RECHECK_MS,
        failures: 0,
      })
    }
  })

  it('polls an uncovered head in a minute and a pull in half a minute', () => {
    expect(due({ outcome: ETargetOutcome.LookedUp, kind: ETargetKind.Head })).toEqual({
      nextDueAt: NOW + TRACKING_POLLED_HEAD_MS,
      failures: 0,
    })
    expect(due({ outcome: ETargetOutcome.Polled, kind: ETargetKind.PullRequest })).toEqual({
      nextDueAt: NOW + TRACKING_POLLED_PULL_MS,
      failures: 0,
    })
  })

  it('treats a superseded target as looked up', () => {
    expect(due({ outcome: ETargetOutcome.Superseded, kind: ETargetKind.Head })).toEqual({
      nextDueAt: NOW + TRACKING_POLLED_HEAD_MS,
      failures: 0,
    })
  })

  it('keeps a merged target on a thirty second cadence through the settle window', () => {
    const mergedAtMs = NOW - TRACKING_MERGED_SETTLE_WINDOW_MS
    expect(due({ outcome: ETargetOutcome.MergedUnsettled, mergedAtMs })).toEqual({
      nextDueAt: NOW + 30_000,
      failures: 0,
    })
  })

  it('retires a merged target once the settle window has passed', () => {
    expect(
      due({
        outcome: ETargetOutcome.MergedUnsettled,
        mergedAtMs: NOW - TRACKING_MERGED_SETTLE_WINDOW_MS - 1,
      }),
    ).toEqual({ nextDueAt: LIVE_UNTIL, failures: 0 })
  })

  it('clamps every result to the live window', () => {
    expect(due({ outcome: ETargetOutcome.LookedUp, liveUntilMs: NOW - 1 })).toEqual({
      nextDueAt: NOW,
      failures: 0,
    })
    expect(due({ outcome: ETargetOutcome.TerminalSettled, liveUntilMs: NOW + 5 })).toEqual({
      nextDueAt: NOW + 5,
      failures: 0,
    })
  })
})
