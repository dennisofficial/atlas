import { describe, expect, it } from 'bun:test'

import { EPodPowerPhase } from '@dltech/atlas-core'

import { EPreviewWait } from '@/features/threads/data/preview-browser/preview-wake'

import {
  EPreviewWakeOutcome,
  previewWakeAttemptOf,
  previewWakeProperties,
  previewWakeReport,
} from '../preview-wake-attempt'

const args = {
  sessionId: 'ses_1',
  url: 'https://3000-abcdefghij.byatlas.dev/',
  phase: EPodPowerPhase.Asleep,
  wait: EPreviewWait.Asleep,
  wakeRequested: true,
  now: 100,
}

const attempt = () => {
  const value = previewWakeAttemptOf(args)
  if (value === undefined) throw new Error('Expected attempt')
  return value
}

describe('preview wake attempt', () => {
  it('only records an open while asleep or starting', () => {
    expect(previewWakeAttemptOf({ ...args, wait: EPreviewWait.Awake })).toBeUndefined()
    expect(
      previewWakeAttemptOf({ ...args, wait: EPreviewWait.Waking, wakeRequested: false }),
    ).toMatchObject({ hostname: '3000-abcdefghij.byatlas.dev', wakeRequested: false })
    expect(previewWakeAttemptOf({ ...args, url: 'invalid' })).toBeUndefined()
  })

  it('keeps waiting through a starting page and DOM readiness', () => {
    const report = {
      attempt: attempt(),
      url: args.url,
      startingPage: true,
      loaded: true,
      visible: true,
    }
    const waiting = previewWakeReport(report)
    expect(waiting.outcome).toBeUndefined()
    expect(waiting.attempt.startingPageSeen).toBe(true)
    expect(
      previewWakeReport({ ...report, startingPage: false, loaded: false }).outcome,
    ).toBeUndefined()
    const visible = previewWakeReport({ ...report, attempt: waiting.attempt, startingPage: false })
    expect(visible.outcome).toBe(EPreviewWakeOutcome.Visible)
    expect(
      previewWakeProperties({
        attempt: visible.attempt,
        outcome: EPreviewWakeOutcome.Visible,
        now: 810,
      }),
    ).toEqual({
      session_id: args.sessionId,
      preview_hostname: '3000-abcdefghij.byatlas.dev',
      pod_phase: EPodPowerPhase.Asleep,
      wake_requested: true,
      outcome: 'visible',
      starting_page_seen: true,
      click_to_visible_ms: 710,
    })
  })

  it('does not call an unknown, hidden or different-host document visible', () => {
    const report = {
      attempt: attempt(),
      url: args.url,
      startingPage: false,
      loaded: true,
      visible: true,
    }
    expect(previewWakeReport({ ...report, startingPage: undefined }).outcome).toBeUndefined()
    expect(previewWakeReport({ ...report, visible: false }).outcome).toBeUndefined()
    expect(previewWakeReport({ ...report, url: 'https://example.com' }).outcome).toBeUndefined()
  })

  it('reports an abandoned attempt with elapsed time, not time to visible', () => {
    const properties = previewWakeProperties({
      attempt: attempt(),
      outcome: EPreviewWakeOutcome.Abandoned,
      now: 550,
    })
    expect(properties).toMatchObject({ outcome: 'abandoned', elapsed_ms: 450 })
    expect(properties).not.toHaveProperty('click_to_visible_ms')
  })
})
