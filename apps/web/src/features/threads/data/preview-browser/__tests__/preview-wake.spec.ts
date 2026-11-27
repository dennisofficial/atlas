import { describe, expect, it } from 'bun:test'

import { EPodPowerPhase } from '@dltech/atlas-core'
import { EPreviewStatus, type PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import { freshBrowser, openTab } from '../browser-model'
import {
  EPreviewWait,
  previewNeedsWake,
  previewOpensOnWake,
  previewWaitOf,
  previewWaitsForPod,
  reloadedPreviews,
} from '../preview-wake'

const WEB: PreviewPort = {
  id: 'service:svc1',
  port: 4321,
  label: 'web',
  url: 'https://4321-abc.byatlas.dev/',
  status: EPreviewStatus.Live,
}

const stateWith = (url: string) => openTab({ state: freshBrowser(), url })

describe('previewWaitOf', () => {
  it('waits while the pod sleeps or stops', () => {
    expect(previewWaitOf(EPodPowerPhase.Asleep)).toBe(EPreviewWait.Asleep)
    expect(previewWaitOf(EPodPowerPhase.Stopping)).toBe(EPreviewWait.Asleep)
  })

  it('waits while the pod starts', () => {
    expect(previewWaitOf(EPodPowerPhase.Starting)).toBe(EPreviewWait.Waking)
  })

  it('does not wait when the pod is steady or reports nothing', () => {
    expect(previewWaitOf(EPodPowerPhase.Steady)).toBe(EPreviewWait.Awake)
    expect(previewWaitOf(undefined)).toBe(EPreviewWait.Awake)
  })
})

describe('previewWaitsForPod', () => {
  it('lets only an awake pod load a preview', () => {
    expect(previewWaitsForPod(EPreviewWait.Awake)).toBe(false)
    expect(previewWaitsForPod(EPreviewWait.Waking)).toBe(true)
    expect(previewWaitsForPod(EPreviewWait.Asleep)).toBe(true)
  })
})

describe('previewNeedsWake', () => {
  it('asks for a wake only from a pod that sleeps', () => {
    expect(previewNeedsWake(EPreviewWait.Asleep)).toBe(true)
    expect(previewNeedsWake(EPreviewWait.Waking)).toBe(false)
    expect(previewNeedsWake(EPreviewWait.Awake)).toBe(false)
  })
})

describe('previewOpensOnWake', () => {
  it('opens on the step from sleeping or waking to awake', () => {
    expect(previewOpensOnWake({ previous: EPreviewWait.Asleep, current: EPreviewWait.Awake })).toBe(
      true,
    )
    expect(previewOpensOnWake({ previous: EPreviewWait.Waking, current: EPreviewWait.Awake })).toBe(
      true,
    )
  })

  it('does not open again while the pod stays awake', () => {
    expect(previewOpensOnWake({ previous: EPreviewWait.Awake, current: EPreviewWait.Awake })).toBe(
      false,
    )
  })

  it('does not open when the pod leaves awake', () => {
    expect(previewOpensOnWake({ previous: EPreviewWait.Awake, current: EPreviewWait.Asleep })).toBe(
      false,
    )
  })
})

describe('reloadedPreviews', () => {
  it('reloads a tab that shows a preview of the session', () => {
    const state = stateWith('https://4321-abc.byatlas.dev/')
    const next = reloadedPreviews({ state, ports: [WEB] })
    expect(next.tabs.map((tab) => tab.load.seq)).toEqual([0, 1])
  })

  it('leaves a tab of another site alone', () => {
    const state = stateWith('https://example.com/')
    expect(reloadedPreviews({ state, ports: [WEB] })).toBe(state)
  })
})
