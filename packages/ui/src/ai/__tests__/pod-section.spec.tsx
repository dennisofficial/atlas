import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  EPodAction,
  POD_CONFIRM_BODY,
  POD_CONFIRM_LABEL,
  POD_CONFIRM_TITLE,
} from '../internal/pod-action-confirm'
import { podDiskGrowOptionsOf } from '../internal/pod-disk-control'
import { podShapeOptionsOf } from '../internal/pod-size-control'
import {
  POD_SECTION_SHAPE,
  POD_SECTION_SHAPES,
  POD_SERIES,
  POD_SERIES_DISK_FULL,
  POD_SERIES_WITH_DISK,
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

  it('says usage is unavailable instead of drawing an empty chart', () => {
    const html = htmlOf({ usageUnavailable: true, series: [] })
    expect(html).toContain('Usage unavailable')
    expect(html).not.toContain('CPU and RAM over the last 15 minutes')
  })

  it('keeps the signals footer', () => {
    const loud = htmlOf({ throttled: true, oomKills: 1 })
    expect(loud).toContain('Throttled')
    expect(loud).toContain('1 OOM kill')
    expect(htmlOf()).not.toContain('Throttled')
  })
})

describe('pod disk row', () => {
  it('stays away when the sample reports no disk', () => {
    const html = htmlOf()
    expect(html).not.toContain('Disk')
    expect(html).not.toContain('aria-label="Increase disk"')
    expect(html).toContain('CPU and RAM over the last 15 minutes')
  })

  it('reads used of limit in GB off the sample and adds disk to the chart', () => {
    const html = htmlOf({ series: POD_SERIES_WITH_DISK, diskGrow: true })
    expect(html).toContain('Disk')
    expect(html).toContain('/ 20 GB')
    expect(html).toContain('CPU, RAM and disk over the last 15 minutes')
    expect(html).toContain('aria-label="Increase disk"')
  })

  it('keeps the grow control off a pod whose provider cannot grow its disk', () => {
    const html = htmlOf({ series: POD_SERIES_WITH_DISK })
    expect(html).toContain('Disk')
    expect(html).not.toContain('aria-label="Increase disk"')
  })

  it('offers only the sizes above the current limit', () => {
    expect(podDiskGrowOptionsOf({ limitGb: 20 })).toEqual([30, 40, 60, 80, 100])
    expect(podDiskGrowOptionsOf({ limitGb: 64 })).toEqual([80, 100])
    expect(podDiskGrowOptionsOf({ limitGb: 100 })).toEqual([])
  })

  it('hides the grow control when no bigger size is left', () => {
    const html = htmlOf({ series: POD_SERIES_DISK_FULL, diskGrow: true })
    expect(html).toContain('/ 100 GB')
    expect(html).not.toContain('aria-label="Increase disk"')
  })
})

describe('pod size control', () => {
  it('shows the current shape in the header beside the power button', () => {
    const html = htmlOf()
    expect(html.indexOf('aria-label="Stop pod"')).toBeLessThan(
      html.indexOf('aria-label="Pod size"'),
    )
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

  it('shows the pending shape in the dropdown without an echo caption', () => {
    const html = htmlOf({ pendingShape: { vcpus: 8, memoryGb: 64 } })
    expect(html).toContain('8 vCPU · 64 GB')
    expect(html).not.toContain('Resizing to')
    const offList = htmlOf({ pendingShape: { vcpus: 8, memoryGb: 32 } })
    expect(offList).toContain(
      'data-slot="select-value" class="flex flex-1 text-left">8 vCPU · 32 GB<',
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
