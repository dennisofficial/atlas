import { describe, expect, it } from 'bun:test'

import { EPodPowerPhase } from '@dltech/atlas-core'
import { EPreviewStatus, type PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import { freshBrowser, openTab } from '../browser-model'
import { openUrlIn } from '../open-in-browser'
import {
  EPreviewWait,
  previewNeedsWake,
  previewReloadsOnWake,
  previewWaitOf,
  revealedPreview,
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

describe('previewNeedsWake', () => {
  it('asks for a wake only from a pod that sleeps', () => {
    expect(previewNeedsWake(EPreviewWait.Asleep)).toBe(true)
    expect(previewNeedsWake(EPreviewWait.Waking)).toBe(false)
    expect(previewNeedsWake(EPreviewWait.Awake)).toBe(false)
  })
})

describe('previewReloadsOnWake', () => {
  it('reloads on the step out of waiting', () => {
    expect(previewReloadsOnWake({ before: EPreviewWait.Asleep, now: EPreviewWait.Awake })).toBe(
      true,
    )
    expect(previewReloadsOnWake({ before: EPreviewWait.Waking, now: EPreviewWait.Awake })).toBe(
      true,
    )
  })

  it('does not reload an awake pod or one that stays away', () => {
    expect(previewReloadsOnWake({ before: EPreviewWait.Awake, now: EPreviewWait.Awake })).toBe(
      false,
    )
    expect(previewReloadsOnWake({ before: EPreviewWait.Asleep, now: EPreviewWait.Waking })).toBe(
      false,
    )
    expect(previewReloadsOnWake({ before: EPreviewWait.Asleep, now: EPreviewWait.Asleep })).toBe(
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

  it('leaves the tab of the pending open to the open that follows', () => {
    const state = stateWith('https://4321-abc.byatlas.dev/')
    const next = reloadedPreviews({
      state,
      ports: [WEB],
      except: 'https://4321-abc.byatlas.dev/',
    })
    expect(next).toBe(state)
  })
})

describe('revealedPreview', () => {
  it('shows and loads the tab that already holds the preview instead of opening another', () => {
    const first = openUrlIn({ state: freshBrowser(), url: 'https://example.com/' })
    const state = openUrlIn({ state: first, url: 'https://4321-abc.byatlas.dev/settings' })
    const next = revealedPreview({
      state,
      url: 'https://4321-abc.byatlas.dev/',
      ports: [WEB],
    })
    expect(next?.tabs).toHaveLength(2)
    expect(next?.activeId).toBe('tab-2')
    expect(next?.tabs[1]?.load.url).toBe('https://4321-abc.byatlas.dev/')
    expect(next?.tabs[1]?.load.seq).toBe(1)
  })

  it('reports nothing when no tab holds the preview', () => {
    expect(
      revealedPreview({
        state: stateWith('https://example.com/'),
        url: 'https://4321-abc.byatlas.dev/',
        ports: [WEB],
      }),
    ).toBeNull()
  })
})
