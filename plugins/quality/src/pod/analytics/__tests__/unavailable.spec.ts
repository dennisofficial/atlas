import { describe, expect, it } from 'bun:test'

import {
  EQualityUnavailableReason,
  forgetUnavailableReports,
  reportUnavailableOnce,
  unavailableProperties,
} from '../unavailable'

describe('reportUnavailableOnce', () => {
  it('reports one reason once per session', () => {
    forgetUnavailableReports()

    expect(
      reportUnavailableOnce({ sessionId: 's1', reason: EQualityUnavailableReason.ClassifierOff }),
    ).toBe(true)
    expect(
      reportUnavailableOnce({ sessionId: 's1', reason: EQualityUnavailableReason.ClassifierOff }),
    ).toBe(false)
  })

  it('reports each reason of a session separately', () => {
    forgetUnavailableReports()

    expect(
      reportUnavailableOnce({ sessionId: 's1', reason: EQualityUnavailableReason.ClassifierOff }),
    ).toBe(true)
    expect(
      reportUnavailableOnce({ sessionId: 's1', reason: EQualityUnavailableReason.SettingOff }),
    ).toBe(true)
  })

  it('reports the same reason for another session', () => {
    forgetUnavailableReports()
    reportUnavailableOnce({ sessionId: 's1', reason: EQualityUnavailableReason.SettingOff })

    expect(
      reportUnavailableOnce({ sessionId: 's2', reason: EQualityUnavailableReason.SettingOff }),
    ).toBe(true)
  })
})

describe('unavailableProperties', () => {
  it('carries the reason alone', () => {
    expect(unavailableProperties({ reason: EQualityUnavailableReason.ClassifierOff })).toEqual({
      reason: 'classifier_off',
    })
  })
})
