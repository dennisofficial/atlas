import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  EPodAction,
  POD_CONFIRM_BODY,
  POD_CONFIRM_LABEL,
  POD_CONFIRM_TITLE,
} from '../internal/pod-action-confirm'
import { podShapeOptionsOf } from '../internal/pod-size-control'
import {
  POD_SECTION_SHAPE,
  POD_SECTION_SHAPES,
  POD_SERIES,
  VERCEL_HOBBY_UNAVAILABLE,
  VERCEL_PRO_SHAPE,
  VERCEL_PRO_SHAPES,
} from '../pod-metrics.fixtures'
import { PodSection, type PodSectionProps } from '../pod-section'
import { podShapeKey, podShapeLabel } from '../pod-shapes'
import { EPodState } from '../pod-status'

const BASE: PodSectionProps = {
  state: EPodState.Running,
  shape: POD_SECTION_SHAPE,
  shapes: POD_SECTION_SHAPES,
  series: POD_SERIES,
}

function htmlOf(overrides: Partial<PodSectionProps> = {}): string {
  return renderToStaticMarkup(<PodSection {...BASE} {...overrides} />)
}

describe('pod section header', () => {
  it('labels the single power button with what pressing it does', () => {
    expect(htmlOf()).toContain('aria-label="Stop pod"')
    expect(htmlOf({ state: EPodState.Parked })).toContain('aria-label="Start pod"')
    expect(htmlOf({ state: EPodState.Stopped })).toContain('aria-label="Start pod"')
  })

  it('names the state in words', () => {
    expect(htmlOf()).toContain('Running')
    expect(htmlOf({ state: EPodState.Parked })).toContain('Sleeping')
    expect(htmlOf({ state: EPodState.Starting })).toContain('Starting…')
    expect(htmlOf({ state: EPodState.Stopped })).toContain('Stopped')
  })

  it('reads resizing instead of running while a resize is in flight', () => {
    const html = htmlOf({ pendingShape: { vcpus: 8, memoryGb: 64 } })
    expect(html).toContain('Resizing…')
    expect(html).not.toContain('>Running<')
    expect(html).toContain('aria-label="Resizing pod"')
  })

  it('spins and disables the power button while the pod comes up or a stop is in flight', () => {
    expect(htmlOf({ state: EPodState.Starting })).toContain('aria-label="Starting pod"')
    expect(htmlOf({ state: EPodState.Starting })).toContain('disabled')
    expect(htmlOf({ stopping: true })).toContain('aria-label="Stopping pod"')
    expect(htmlOf({ stopping: true })).toContain('disabled')
  })
})

describe('pod section chart', () => {
  it('draws the live chart only while the pod runs', () => {
    expect(htmlOf()).toContain('CPU and RAM over the last 15 minutes')
  })

  it('keeps the same rows while asleep with an empty chart and no stale values', () => {
    const asleep = htmlOf({ state: EPodState.Parked })
    expect(asleep).toContain('No live usage — pod asleep')
    expect(asleep).toContain('CPU')
    expect(asleep).toContain('— / 16 GB')
    expect(asleep).not.toContain('35%')
    expect(asleep).not.toContain('CPU and RAM over the last 15 minutes')
  })

  it('reads the RAM limit off the shape, not off two GB per vCPU', () => {
    expect(htmlOf()).toContain('/ 16 GB')
    expect(htmlOf({ shape: { vcpus: 4, memoryGb: 8 } })).toContain('/ 8 GB')
  })

  it('keeps the signals footer', () => {
    const loud = htmlOf({ throttled: true, oomKills: 1 })
    expect(loud).toContain('Throttled')
    expect(loud).toContain('1 OOM kill')
    expect(htmlOf()).not.toContain('Throttled')
  })
})

describe('pod size control', () => {
  it('shows the current shape behind a Size label', () => {
    const html = htmlOf()
    expect(html).toContain('Size')
    expect(html).toContain('aria-label="Pod size"')
    expect(html).toContain(podShapeLabel(POD_SECTION_SHAPE))
  })

  it('offers every shape the provider has, keyed by both values', () => {
    const options = podShapeOptionsOf({
      shapes: POD_SECTION_SHAPES,
      current: POD_SECTION_SHAPE,
    })
    expect(options.map((option) => option.label)).toEqual([
      '2 vCPU · 4 GB',
      '4 vCPU · 8 GB',
      '4 vCPU · 16 GB',
      '4 vCPU · 32 GB',
      '8 vCPU · 64 GB',
    ])
    expect(new Set(options.map((option) => option.key)).size).toBe(POD_SECTION_SHAPES.length)
    expect(options.every((option) => option.disabled === false)).toBe(true)
  })

  it('lists shapes above the plan cap as disabled with the reason', () => {
    const options = podShapeOptionsOf({
      shapes: VERCEL_PRO_SHAPES,
      unavailable: VERCEL_HOBBY_UNAVAILABLE,
      current: VERCEL_PRO_SHAPE,
    })
    const blocked = options.filter((option) => option.disabled)
    expect(blocked.map((option) => option.label)).toEqual(['6 vCPU · 12 GB', '8 vCPU · 16 GB'])
    expect(blocked.map((option) => option.reason)).toEqual(['Needs Pro plan', 'Needs Pro plan'])
  })

  it('keeps the current shape in the list even when it is not offered', () => {
    const options = podShapeOptionsOf({
      shapes: VERCEL_PRO_SHAPES,
      unavailable: VERCEL_HOBBY_UNAVAILABLE,
      current: POD_SECTION_SHAPE,
    })
    expect(options.map((option) => option.key)).toContain(podShapeKey(POD_SECTION_SHAPE))
    expect(
      options.some((option) => option.disabled && option.key === podShapeKey(POD_SECTION_SHAPE)),
    ).toBe(false)
  })

  it('names the pending shape and warns that the pod restarts', () => {
    const pending = { vcpus: 8, memoryGb: 64 }
    expect(htmlOf({ pendingShape: pending })).toContain(
      'Resizing to 8 vCPU · 64 GB — the pod restarts',
    )
  })

  it('offers a retry when the resize failed', () => {
    const failed = htmlOf({
      pendingShape: { vcpus: 8, memoryGb: 64 },
      resizeError: 'The pod did not come back in time',
    })
    expect(failed).toContain('Could not resize the pod. The pod did not come back in time')
    expect(failed).toContain('Retry')
  })

  it('locks the dropdown while the pod starts or a resize is in flight', () => {
    expect(htmlOf({ state: EPodState.Starting })).toContain('disabled')
    expect(htmlOf({ pendingShape: { vcpus: 8, memoryGb: 64 } })).toContain('disabled')
    expect(htmlOf({ state: EPodState.Stopped })).toContain('disabled')
  })
})

describe('pod action confirm', () => {
  it('asks before stopping and keeps the reason short', () => {
    expect(POD_CONFIRM_TITLE[EPodAction.Stop]).toBe('Stop the pod?')
    expect(POD_CONFIRM_BODY).toBe(
      'The current turn stops and running processes end. Files are kept.',
    )
    expect(POD_CONFIRM_LABEL[EPodAction.Stop]).toBe('Stop')
  })

  it('asks before restarting for a resize', () => {
    expect(POD_CONFIRM_TITLE[EPodAction.Resize]).toBe('Restart the pod?')
    expect(POD_CONFIRM_LABEL[EPodAction.Resize]).toBe('Restart')
  })
})
