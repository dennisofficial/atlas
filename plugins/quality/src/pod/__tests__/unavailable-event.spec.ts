import { beforeEach, describe, expect, it } from 'bun:test'

import { EAnalyticsLinks } from '@dltech/atlas-plugin-sdk'
import { EToolEffect } from '@dltech/atlas-core'

import { forgetUnavailableReports } from '../analytics/unavailable'
import { analyticsRecorder, createRig, readCall, wroteNothing, writeCall } from './support'

const bashCall = (command: string) =>
  writeCall({ name: 'bash', effect: EToolEffect.Destructive, input: { description: 'x', command } })

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

  it('reports a bash write into the workspace once per session', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({ analytics })

    expect(await rig.captures(bashCall('echo x > src/a.ts'))).toBe(false)
    await rig.run({ call: bashCall('echo x > src/a.ts'), result: wroteNothing() })
    await rig.run({ call: bashCall("sed -i 's/a/b/' src/b.ts"), result: wroteNothing() })

    expect(captured).toEqual([
      {
        event: 'quality review unavailable',
        properties: { reason: 'bash_write' },
        links: EAnalyticsLinks.Hashed,
      },
    ])
  })

  it('reports nothing for a bash call that writes no workspace file', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({ analytics })

    await rig.run({ call: bashCall('bun test'), result: wroteNothing() })
    await rig.run({ call: bashCall('echo x > /tmp/a.ts'), result: wroteNothing() })

    expect(captured).toEqual([])
  })

  it('reports the setting being off for a bash write', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({ analytics, settings: { enabled: false, policies: {} } })

    await rig.run({ call: bashCall('echo x > src/a.ts'), result: wroteNothing() })

    expect(captured).toEqual([
      {
        event: 'quality review unavailable',
        properties: { reason: 'setting_off' },
        links: EAnalyticsLinks.Hashed,
      },
    ])
  })
})
