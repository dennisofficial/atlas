import { beforeEach, describe, expect, it } from 'bun:test'

import { EAnalyticsLinks } from '@dltech/atlas-plugin-sdk'

import { forgetUnavailableReports } from '../analytics/unavailable'
import { analyticsRecorder, createRig, readCall, writeCall } from './support'

beforeEach(() => {
  forgetUnavailableReports()
})

describe('the unavailable event', () => {
  it('reports a write that the classifier is off for once per session', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({ analytics, classifierOn: false })

    await rig.captures(writeCall())
    await rig.captures(writeCall())

    expect(captured).toEqual([
      {
        event: 'quality review unavailable',
        properties: { reason: 'classifier_off' },
        links: EAnalyticsLinks.Hashed,
      },
    ])
  })

  it('reports the setting being off for a write', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({ analytics, settings: { enabled: false, policies: {} } })

    await rig.captures(writeCall())

    expect(captured).toEqual([
      {
        event: 'quality review unavailable',
        properties: { reason: 'setting_off' },
        links: EAnalyticsLinks.Hashed,
      },
    ])
  })

  it('reports nothing for a read call', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({ analytics, classifierOn: false })

    await rig.captures(readCall())

    expect(captured).toEqual([])
  })
})
