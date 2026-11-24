import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
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
import { formatCpu, formatRam } from '../pod-metrics-model'
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

function sampleAt(index: number) {
  const sample = POD_SERIES[index]
  if (sample === undefined) throw new Error(`the fixture series has no sample ${index}`)
  return sample
}

const legendTipOf = (index: number) => {
  const sample = sampleAt(index)
  return {
    cpu: formatCpu(sample.cpu),
    ram: formatRam({ usedGb: sample.ramGb, limitGb: POD_SECTION_SHAPE.memoryGb }),
  }
}

function diskTipOf(index: number): string {
  const sample = POD_SERIES_WITH_DISK[index]
  if (sample?.diskUsedGb === undefined || sample.diskLimitGb === undefined)
    throw new Error(`the fixture series has no disk at sample ${index}`)
  return formatRam({ usedGb: sample.diskUsedGb, limitGb: sample.diskLimitGb })
}

function growButtonOf(html: string): string {
  const button = html.match(/<button[^>]*aria-label="Increase disk"[^>]*>/)?.[0]
  if (button === undefined) throw new Error('the grow control did not render')
  return button
}

function sizeTriggerOf(html: string): string {
  const trigger = html.match(/<button[^>]*aria-label="Pod size"[^>]*>/)?.[0]
  if (trigger === undefined) throw new Error('the size control did not render')
  return trigger
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

  it('offers an outlined square to stop and a play triangle to start, both unfilled', () => {
    const running = htmlOf()
    expect(running).toContain('lucide-square')
    expect(running).not.toContain('lucide-play')
    const stopped = htmlOf({ state: EPodState.Stopped })
    expect(stopped).toContain('lucide-play')
    expect(stopped).not.toContain('lucide-square')
    expect(running).not.toContain('fill-current')
    expect(stopped).not.toContain('fill-current')
  })

  it('draws the power control as a bordered button', () => {
    expect(htmlOf()).toMatch(/<button[^>]*aria-label="Stop pod"[^>]*border-border/)
  })

  it('spins and disables the power button while the pod comes up or a stop is in flight', () => {
    expect(htmlOf({ state: EPodState.Starting })).toContain('aria-label="Starting pod"')
    expect(htmlOf({ state: EPodState.Starting })).toContain('disabled')
    expect(htmlOf({ starting: true })).toContain('aria-label="Starting pod"')
    expect(htmlOf({ starting: true })).toContain('disabled')
    expect(htmlOf({ stopping: true })).toContain('aria-label="Stopping pod"')
    expect(htmlOf({ stopping: true })).toContain('disabled')
  })

  it('keeps the stop ahead of a start when both are in flight', () => {
    expect(htmlOf({ starting: true, stopping: true })).toContain('aria-label="Stopping pod"')
  })

  it('says why the pod did not come up under the header', () => {
    const html = htmlOf({ message: 'The pod did not report running. Try again.' })
    expect(html).toContain(
      '<p class="text-xs text-muted-foreground">The pod did not report running. Try again.</p>',
    )
    expect(htmlOf()).not.toContain('Try again.')
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

  it('keeps the spark inside a bordered chart box', () => {
    const html = htmlOf()
    expect(html).toContain('bg-muted/30')
    expect(html).toContain('border border-border bg-muted/30 p-1')
  })

  it('shows the values at the pinned sample, never a stretched history', () => {
    const html = htmlOf({ defaultActiveIndex: 4 })
    expect(htmlOf()).not.toContain('data-slot="pod-spark-tip"')
    expect(html).toContain('data-slot="pod-spark-tip"')
    const expected = legendTipOf(4)
    expect(html).toContain(`CPU ${expected.cpu}`)
    expect(html).toContain(`RAM ${expected.ram}`)
  })

  it('keeps the signals footer', () => {
    const loud = htmlOf({ throttled: true, oomEvents: 1, oomKills: 3 })
    expect(loud).toContain('Throttled')
    expect(loud).toContain('1 out-of-memory kill (3 processes)')
    expect(htmlOf()).not.toContain('Throttled')
  })
})

describe('pod disk row', () => {
  it('keeps the disk row with an empty value when the sample reports no disk', () => {
    const html = htmlOf()
    expect(html).toMatch(/Disk<\/span><span[^>]*>—<\/span>/)
    expect(html).not.toContain('aria-label="Increase disk"')
    expect(html).toContain('CPU and RAM over the last 15 minutes')
  })

  it('keeps the disk row and its limit while the pod sleeps', () => {
    const asleep = htmlOf({ state: EPodState.Parked, series: POD_SERIES_WITH_DISK })
    expect(asleep).toContain('— / 20 GB')
  })

  it('keeps the grow control, disabled, until the disk size is known', () => {
    expect(growButtonOf(htmlOf({ diskGrow: true }))).toContain('disabled=""')
  })

  it('keeps every row and an empty chart before the first sample arrives', () => {
    const html = htmlOf({ series: [] })
    expect(html).toContain('CPU')
    expect(html).toContain('RAM')
    expect(html).toContain('Disk')
    expect(html).toContain('No samples')
  })

  it('reads used of limit in GB off the sample and adds disk to the chart', () => {
    const html = htmlOf({ series: POD_SERIES_WITH_DISK, diskGrow: true })
    expect(html).toContain('Disk')
    expect(html).toContain('/ 20 GB')
    expect(html).toContain('CPU, RAM and disk over the last 15 minutes')
    expect(html).toContain('aria-label="Increase disk"')
  })

  it('reads the disk of the pinned sample in the tip', () => {
    const html = htmlOf({ series: POD_SERIES_WITH_DISK, defaultActiveIndex: 4 })
    expect(html).toContain(`Disk ${diskTipOf(4)}`)
  })

  it('keeps the disk out of the tip of a pod that reports none', () => {
    expect(htmlOf({ defaultActiveIndex: 4 })).not.toMatch(/Disk \d/)
  })

  it('keeps the grow control off a pod whose provider cannot grow its disk', () => {
    const html = htmlOf({ series: POD_SERIES_WITH_DISK })
    expect(html).toContain('Disk')
    expect(html).not.toContain('aria-label="Increase disk"')
  })

  it('reads the disk limit off the sample, over the limit the status pushes', () => {
    const html = htmlOf({ series: POD_SERIES_WITH_DISK, diskLimitGb: 40 })
    expect(html).toContain('/ 20 GB')
    expect(html).not.toContain('/ 40 GB')
  })

  it('keeps the pushed disk limit before the first sample arrives', () => {
    const html = htmlOf({ series: [], diskLimitGb: 40 })
    expect(html).toContain('— / 40 GB')
  })

  it('keeps the pushed disk limit while the pod sleeps', () => {
    const asleep = htmlOf({ state: EPodState.Parked, series: [], diskLimitGb: 40 })
    expect(asleep).toContain('— / 40 GB')
  })

  it('enables the grow control from the pushed limit, before any sample arrives', () => {
    const grow = growButtonOf(htmlOf({ series: [], diskLimitGb: 40, diskGrow: true }))
    expect(grow).not.toContain('disabled=""')
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

describe('pod resize waiting', () => {
  beforeAll(() => {
    GlobalRegistrator.register()
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  afterAll(async () => {
    await GlobalRegistrator.unregister()
  })

  const WAITING: Partial<PodSectionProps> = {
    pendingShape: { vcpus: 8, memoryGb: 64 },
    resizeWaiting: true,
  }

  const mount = async (props: Partial<PodSectionProps> = {}) => {
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => root.render(<PodSection {...BASE} {...WAITING} {...props} />))
    return { container, unmount: () => act(async () => root.unmount()) }
  }

  const buttonNamed = (container: HTMLElement, name: string) =>
    [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(name))

  const click = (button: Element | null | undefined) =>
    act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

  it('reads the wait instead of a resize in flight in the header', () => {
    const html = htmlOf(WAITING)
    expect(html).toContain('Waiting for idle…')
    expect(html).not.toContain('Resizing…')
    expect(html).toContain('aria-label="Waiting to resize pod"')
  })

  it('names the size it will move to and keeps the size control locked', () => {
    const html = htmlOf(WAITING)
    expect(html).toContain('Resizes to 8 vCPU · 64 GB when the pod is idle.')
    expect(sizeTriggerOf(html)).toContain('disabled')
  })

  it('sends the resize at once and the cancel when pressed', async () => {
    const onResizeNow = mock(() => Promise.resolve())
    const onCancelResize = mock(() => Promise.resolve())
    const view = await mount({ onResizeNow, onCancelResize })
    await click(buttonNamed(view.container, 'Resize now'))
    expect(onResizeNow).toHaveBeenCalledTimes(1)
    await click(buttonNamed(view.container, 'Cancel'))
    expect(onCancelResize).toHaveBeenCalledTimes(1)
    await view.unmount()
  })

  it('disables both actions and spins the pressed one while it runs', async () => {
    let settle: () => void = () => undefined
    const onResizeNow = mock(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve
        }),
    )
    const view = await mount({ onResizeNow, onCancelResize: mock(() => Promise.resolve()) })
    await click(buttonNamed(view.container, 'Resize now'))
    const resizeNow = buttonNamed(view.container, 'Resize now')
    const cancel = buttonNamed(view.container, 'Cancel')
    expect(resizeNow?.disabled).toBe(true)
    expect(cancel?.disabled).toBe(true)
    expect(resizeNow?.querySelector('[data-slot="spinner"]')).not.toBeNull()
    expect(cancel?.querySelector('[data-slot="spinner"]')).toBeNull()
    await act(async () => settle())
    expect(buttonNamed(view.container, 'Resize now')?.disabled).toBe(false)
    await view.unmount()
  })

  it('shows why the server refused the resize', async () => {
    const onResizeNow = mock(() =>
      Promise.reject(new Error('No resize is waiting for the pod to go idle')),
    )
    const view = await mount({ onResizeNow, onCancelResize: mock(() => Promise.resolve()) })
    await click(buttonNamed(view.container, 'Resize now'))
    expect(view.container.querySelector('.text-destructive')?.textContent).toContain(
      'No resize is waiting for the pod to go idle',
    )
    await view.unmount()
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

describe('pod spark on touch', () => {
  beforeAll(() => {
    GlobalRegistrator.register()
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  afterAll(async () => {
    await GlobalRegistrator.unregister()
  })

  const mount = async (props: Partial<PodSectionProps> = {}) => {
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => root.render(<PodSection {...BASE} {...props} />))
    return { container, unmount: () => act(async () => root.unmount()) }
  }

  const plotOf = () => {
    const plot = document.querySelector('[data-slot="pod-spark-plot"]')
    if (plot === null) throw new Error('the spark plot did not render')
    return plot
  }

  const tipOf = () => document.querySelector('[data-slot="pod-spark-tip"]')

  const tap = async (target: Element) => {
    await act(async () => {
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 40 }))
    })
  }

  it('opens the tip with the sample under the finger and closes it on a tap outside', async () => {
    const { unmount } = await mount()
    expect(tipOf()).toBeNull()

    await tap(plotOf())
    const expected = legendTipOf(POD_SERIES.length - 1)
    expect(tipOf()?.textContent).toContain(`CPU ${expected.cpu}`)
    expect(tipOf()?.textContent).toContain(`RAM ${expected.ram}`)

    await tap(document.body)
    expect(tipOf()).toBeNull()
    await unmount()
  })

  it('keeps the tip while the finger drags across the plot', async () => {
    const { unmount } = await mount()
    await tap(plotOf())
    await act(async () => {
      plotOf().dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, clientX: 60, pointerType: 'touch' }),
      )
    })
    expect(tipOf()).not.toBeNull()
    await unmount()
  })
})

describe('pod memory signals', () => {
  it('counts out-of-memory events, not killed processes', () => {
    expect(htmlOf({ oomEvents: 1, oomKills: 12 })).toContain('1 out-of-memory kill (12 processes)')
    expect(htmlOf({ oomEvents: 2, oomKills: 14 })).toContain('2 out-of-memory kills (14 processes)')
    expect(htmlOf({ oomEvents: 2 })).toContain('2 out-of-memory kills')
  })

  it('falls back to the killed processes for a pod that reports no events', () => {
    expect(htmlOf({ oomKills: 12 })).toContain('12 processes killed for memory')
    expect(htmlOf({ oomKills: 1 })).toContain('1 process killed for memory')
    expect(htmlOf()).not.toContain('killed for memory')
  })

  it('shows the command memory limit next to the pod RAM', () => {
    expect(htmlOf({ commandRamLimitGb: 2.3 })).toContain('commands ≤ 2.3 GB')
    expect(htmlOf()).not.toContain('commands ≤')
  })
})

describe('pod size menu', () => {
  beforeAll(() => {
    GlobalRegistrator.register()
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  afterAll(async () => {
    await GlobalRegistrator.unregister()
  })

  it('opens the size menu when asked', async () => {
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () =>
      root.render(<PodSection {...BASE} sizeMenuOpen onSizeMenuOpenChange={() => {}} />),
    )
    expect(document.querySelector('[data-slot="select-content"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Pod size"]')?.getAttribute('aria-expanded')).toBe(
      'true',
    )
    await act(async () => root.unmount())
    container.remove()
  })
})
