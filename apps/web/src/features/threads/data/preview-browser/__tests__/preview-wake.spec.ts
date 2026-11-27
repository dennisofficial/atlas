import { describe, expect, it } from 'bun:test'

import { EPodPowerPhase } from '@dltech/atlas-core'
import { EPreviewStatus, type PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import { type BrowserState, freshBrowser, openTab } from '../browser-model'
import { openUrlIn } from '../open-in-browser'
import {
  EPreviewShift,
  EPreviewWait,
  previewNeedsWake,
  previewShiftOf,
  previewWaitOf,
  previewsShifted,
  revealedPreview,
} from '../preview-wake'

const WEB: PreviewPort = {
  id: 'service:svc1',
  port: 4321,
  label: 'web',
  url: 'https://4321-abc.byatlas.dev/',
  status: EPreviewStatus.Live,
}

const stateWith = (url: string) => openTab({ state: freshBrowser(), url })

const seqsOf = (state: BrowserState) => state.tabs.map((tab) => tab.load.seq)

const drive = (args: {
  state: BrowserState
  phases: (EPodPowerPhase | undefined)[]
}): BrowserState => {
  let state = args.state
  let before: EPreviewWait | undefined
  for (const phase of args.phases) {
    const now = previewWaitOf(phase)
    state = previewsShifted({ state, ports: [WEB], shift: previewShiftOf({ before, now }) })
    before = now
  }
  return state
}

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

describe('previewShiftOf', () => {
  it('marks the sleep when the pod leaves awake for a sleeping state', () => {
    expect(previewShiftOf({ before: EPreviewWait.Awake, now: EPreviewWait.Asleep })).toBe(
      EPreviewShift.Slept,
    )
    expect(previewShiftOf({ before: EPreviewWait.Waking, now: EPreviewWait.Asleep })).toBe(
      EPreviewShift.Slept,
    )
  })

  it('reports the wake from any waiting state', () => {
    expect(previewShiftOf({ before: EPreviewWait.Asleep, now: EPreviewWait.Awake })).toBe(
      EPreviewShift.Woke,
    )
    expect(previewShiftOf({ before: EPreviewWait.Waking, now: EPreviewWait.Awake })).toBe(
      EPreviewShift.Woke,
    )
  })

  it('reports nothing for an awake pod, a pod that stays away, or a first look', () => {
    expect(previewShiftOf({ before: EPreviewWait.Awake, now: EPreviewWait.Awake })).toBe(
      EPreviewShift.None,
    )
    expect(previewShiftOf({ before: EPreviewWait.Asleep, now: EPreviewWait.Waking })).toBe(
      EPreviewShift.None,
    )
    expect(previewShiftOf({ before: EPreviewWait.Asleep, now: EPreviewWait.Asleep })).toBe(
      EPreviewShift.None,
    )
    expect(previewShiftOf({ before: undefined, now: EPreviewWait.Asleep })).toBe(EPreviewShift.None)
  })
})

describe('previewsShifted', () => {
  it('reloads a tab whose load predates the sleep once the pod wakes', () => {
    const state = stateWith(WEB.url)
    const slept = drive({ state, phases: [EPodPowerPhase.Steady, EPodPowerPhase.Asleep] })
    expect(seqsOf(slept)).toEqual([0, 0])
    const woke = drive({ state: slept, phases: [EPodPowerPhase.Starting, EPodPowerPhase.Steady] })
    expect(seqsOf(woke)).toEqual([0, 1])
  })

  it('reloads such a tab exactly once', () => {
    const state = stateWith(WEB.url)
    const awake = drive({
      state,
      phases: [
        EPodPowerPhase.Steady,
        EPodPowerPhase.Asleep,
        EPodPowerPhase.Starting,
        EPodPowerPhase.Steady,
        EPodPowerPhase.Steady,
      ],
    })
    expect(seqsOf(awake)).toEqual([0, 1])
  })

  it('reloads once while the phase bounces on the way up', () => {
    const state = stateWith(WEB.url)
    const bounced = drive({
      state,
      phases: [
        EPodPowerPhase.Steady,
        EPodPowerPhase.Asleep,
        EPodPowerPhase.Starting,
        EPodPowerPhase.Steady,
        EPodPowerPhase.Starting,
        EPodPowerPhase.Steady,
        EPodPowerPhase.Starting,
        EPodPowerPhase.Steady,
      ],
    })
    expect(seqsOf(bounced)).toEqual([0, 1])
  })

  it('leaves a tab alone when its load started while the pod was away', () => {
    const slept = drive({
      state: stateWith(WEB.url),
      phases: [EPodPowerPhase.Steady, EPodPowerPhase.Asleep],
    })
    const opened = revealedPreview({ state: slept, url: WEB.url, ports: [WEB] }) ?? slept
    expect(seqsOf(opened)).toEqual([0, 1])
    const woke = drive({ state: opened, phases: [EPodPowerPhase.Starting, EPodPowerPhase.Steady] })
    expect(seqsOf(woke)).toEqual([0, 1])
  })

  it('leaves a tab that never saw the pod awake alone', () => {
    const state = stateWith(WEB.url)
    expect(
      seqsOf(drive({ state, phases: [EPodPowerPhase.Asleep, EPodPowerPhase.Steady] })),
    ).toEqual([0, 0])
  })

  it('leaves a tab of another site alone', () => {
    const state = stateWith('https://example.com/')
    const slept = drive({ state, phases: [EPodPowerPhase.Steady, EPodPowerPhase.Asleep] })
    expect(slept).toBe(state)
    expect(previewsShifted({ state: slept, ports: [WEB], shift: EPreviewShift.Woke })).toBe(state)
  })

  it('leaves the state alone when nothing shifts', () => {
    const state = stateWith(WEB.url)
    expect(previewsShifted({ state, ports: [WEB], shift: EPreviewShift.None })).toBe(state)
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
