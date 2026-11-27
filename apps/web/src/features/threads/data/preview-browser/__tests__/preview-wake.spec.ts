import { describe, expect, it } from 'bun:test'

import { EPodPowerPhase } from '@dltech/atlas-core'
import { EPreviewStatus, type PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import { freshBrowser, openTab } from '../browser-model'
import { openUrlIn } from '../open-in-browser'
import {
  EPreviewWait,
  previewNeedsWake,
  previewOpensOnReady,
  previewWaitOf,
  previewWaitsForPod,
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

describe('previewOpensOnReady', () => {
  it('opens on the first tunnel-ready signal the click has not seen', () => {
    expect(previewOpensOnReady({ seen: 'at-1', now: 'at-2' })).toBe(true)
    expect(previewOpensOnReady({ seen: undefined, now: 'at-1' })).toBe(true)
  })

  it('does not open again on the ready signal that was already there', () => {
    expect(previewOpensOnReady({ seen: 'at-1', now: 'at-1' })).toBe(false)
    expect(previewOpensOnReady({ seen: undefined, now: undefined })).toBe(false)
  })

  it('does not open when the ready signal leaves the window', () => {
    expect(previewOpensOnReady({ seen: 'at-1', now: undefined })).toBe(false)
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
