import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ESessionStatus } from '@dltech/atlas-core'
import { EPodState, ResizeDeclinedError } from '@dltech/atlas-ui/ai/pod-status-chip'
import { ESandboxProvider, ESandboxStatus } from '@dltech/atlas-protocol'

import {
  POD_RESTART_BODY,
  ResizeBusyDialog,
  useDiskResizeConfirmation,
  useShapeResizeConfirmation,
  type PodDiskRequest,
  type PodShapeRequest,
} from '@/features/pods/pod-resize-confirmation'

import { resizePod } from '../../data/pod-resources'
import type { PodMetricsSample } from '../../data/pod-metrics-series'
import type { PodPower } from '../../data/use-pod-power'
import { PodPaneSection, podBusyOfView, podSectionViewOf } from '../details/pod-section'
import { paneValueFixture, previewFixture, populatedPaneValue, viewModelFixture } from './fixture'

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(() => {
  document.body.innerHTML = ''
})

type BusyStatus = { state: ESessionStatus; setupRunning?: boolean | undefined }

const mount = async (element: React.ReactElement) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(element))
  return () => act(async () => root.unmount())
}

const click = (element: Element | null | undefined) =>
  act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })

const buttonNamed = (name: string) =>
  [...document.body.querySelectorAll('button')].find((button) => button.textContent?.includes(name))

const powerOf = (phase: PodPower['state']['phase'] = 'awake'): PodPower => ({
  state: { phase },
  message: undefined,
  sleep: () => undefined,
  forceSleep: () => undefined,
  wake: () => undefined,
  cancel: () => undefined,
})

const sample = (overrides: Partial<PodMetricsSample> = {}): PodMetricsSample => ({
  t: 1_000,
  cpu: 42,
  ramGb: 3,
  throttled: false,
  oomKills: 0,
  ...overrides,
})

const diskSample = (overrides: Partial<PodMetricsSample> = {}): PodMetricsSample =>
  sample({ diskUsedGb: 14.2, diskLimitGb: 20, ...overrides })

const sectionOf = (overrides: Partial<React.ComponentProps<typeof PodPaneSection>> = {}) => (
  <PodPaneSection
    state={EPodState.Running}
    shape={{ vcpus: 4, memoryGb: 16 }}
    shapes={[
      { vcpus: 2, memoryGb: 4 },
      { vcpus: 4, memoryGb: 16 },
    ]}
    unavailable={[]}
    agent37={false}
    series={[sample()]}
    power={powerOf()}
    onStart={() => undefined}
    onStop={() => undefined}
    onConfirm={() => undefined}
    onCancel={() => undefined}
    onResize={() => undefined}
    onGrowDisk={() => undefined}
    {...overrides}
  />
)

describe('podSectionViewOf', () => {
  it('keeps the section with the default shape before the pod state is pushed', () => {
    const view = podSectionViewOf({ pod: undefined, live: false })
    expect(view.state).toBe(EPodState.Parked)
    expect(view.shape).toEqual({ vcpus: 2, memoryGb: 4 })
  })

  it('reads the shape, the sizes and the resize phase off the pushed pod', () => {
    const view = podSectionViewOf({
      pod: {
        shape: { vcpus: 4, memoryGb: 16 },
        desiredShape: { vcpus: 8, memoryGb: 64 },
        phase: 'resizing',
        sizing: {
          cap: 8,
          offered: [
            { vcpus: 4, memoryGb: 16 },
            { vcpus: 8, memoryGb: 64 },
          ],
          unavailable: [{ shape: { vcpus: 8, memoryGb: 64 }, reason: 'Needs Pro plan' }],
        },
      },
      live: true,
      sandbox: { status: ESandboxStatus.Running, at: '2026-11-21T10:00:00.000Z' },
    })
    expect(view).toEqual({
      state: EPodState.Running,
      shape: { vcpus: 4, memoryGb: 16 },
      shapes: [
        { vcpus: 4, memoryGb: 16 },
        { vcpus: 8, memoryGb: 64 },
      ],
      unavailable: [{ shape: { vcpus: 8, memoryGb: 64 }, reason: 'Needs Pro plan' }],
      agent37: false,
      pendingShape: { vcpus: 8, memoryGb: 64 },
    })
  })

  it('knows an Agent37 pod, the only one whose disk the operator can grow', () => {
    const pod = { phase: 'steady' as const, sizing: { cap: 8, offered: [], unavailable: [] } }
    expect(
      podSectionViewOf({ pod, live: true, sandboxProvider: ESandboxProvider.Agent37 })?.agent37,
    ).toBe(true)
    expect(
      podSectionViewOf({ pod, live: true, sandboxProvider: ESandboxProvider.Vercel })?.agent37,
    ).toBe(false)
  })

  it('takes the state the sandbox declares over the lease', () => {
    const view = podSectionViewOf({
      pod: { phase: 'steady', sizing: { cap: 8, offered: [], unavailable: [] } },
      live: true,
      sandbox: { status: ESandboxStatus.Sleeping, at: '2026-11-21T10:00:00.000Z' },
    })
    expect(view?.state).toBe(EPodState.Parked)
  })

  it('falls back to the lease for a Vercel sandbox that declares nothing', () => {
    const live = podSectionViewOf({
      pod: { phase: 'steady', sizing: { cap: 8, offered: [], unavailable: [] } },
      live: true,
    })
    const parked = podSectionViewOf({
      pod: { phase: 'steady', sizing: { cap: 8, offered: [], unavailable: [] } },
      live: false,
    })
    expect(live?.state).toBe(EPodState.Running)
    expect(parked?.state).toBe(EPodState.Parked)
  })

  it('names a failed resize and offers a shape when the pod has not reported one', () => {
    const view = podSectionViewOf({
      pod: {
        phase: 'failed',
        error: 'vCPUs above 8 need an Enterprise plan',
        sizing: { cap: 8, offered: [], unavailable: [] },
      },
      live: true,
    })
    expect(view?.resizeError).toBe('vCPUs above 8 need an Enterprise plan')
    expect(view?.shape).toEqual({ vcpus: 2, memoryGb: 4 })
  })

  it('keeps the cpu of a pod whose memory was never recorded, instead of the default shape', () => {
    const view = podSectionViewOf({
      pod: {
        shape: { vcpus: 4, memoryGb: null },
        actualVcpus: 4,
        phase: 'steady',
        sizing: {
          cap: 8,
          offered: [
            { vcpus: 2, memoryGb: 4 },
            { vcpus: 4, memoryGb: 8 },
            { vcpus: 4, memoryGb: 32 },
            { vcpus: 8, memoryGb: 64 },
          ],
          unavailable: [],
        },
      },
      live: false,
      sandbox: { status: ESandboxStatus.Sleeping, at: '2026-11-21T10:00:00.000Z' },
    })

    expect(view?.shape).toEqual({ vcpus: 4, memoryGb: 8 })
  })
})

describe('PodPaneSection', () => {
  it('puts the power button, the state and the size control in one header row', () => {
    const html = renderToStaticMarkup(sectionOf())
    expect(html).toContain('aria-label="Pod"')
    expect(html).toContain('aria-label="Stop pod"')
    expect(html).toContain('aria-label="Pod size"')
    expect(html.indexOf('aria-label="Stop pod"')).toBeLessThan(
      html.indexOf('aria-label="Pod size"'),
    )
  })

  it('shows live CPU and RAM with the shape as the RAM limit', () => {
    const html = renderToStaticMarkup(sectionOf())
    expect(html).toContain('CPU')
    expect(html).toContain('3 / 16 GB')
    expect(html).toContain('CPU and RAM over the last 15 minutes')
  })

  it('shows an empty chart state instead of a blank chart without a series', () => {
    const running = renderToStaticMarkup(sectionOf({ series: [] }))
    expect(running).toContain('CPU')
    expect(running).toContain('Disk')
    expect(running).toContain('No live usage yet')
    expect(running).not.toContain('over the last 15 minutes')
    const asleep = renderToStaticMarkup(sectionOf({ series: [], state: EPodState.Parked }))
    expect(asleep).toContain('No live usage — pod asleep')
  })

  it('says usage is unavailable when the pod cannot report it', () => {
    const html = renderToStaticMarkup(sectionOf({ usageUnavailable: true, series: [] }))
    expect(html).toContain('Usage unavailable')
    expect(html).not.toContain('CPU and RAM over the last 15 minutes')
  })

  it('keeps the throttle and OOM signals from the latest sample', () => {
    const html = renderToStaticMarkup(
      sectionOf({ series: [sample({ throttled: true, oomEvents: 2, oomKills: 3 })] }),
    )
    expect(html).toContain('Throttled')
    expect(html).toContain('2 out-of-memory kills (3 processes)')
  })

  it('shows the command memory limit beside the pod RAM', () => {
    const html = renderToStaticMarkup(sectionOf({ series: [sample({ commandRamLimitGb: 2.3 })] }))
    expect(html).toContain('3 / 16 GB · commands ≤ 2.3 GB')
  })

  it('offers to start a parked pod instead of stopping it', () => {
    const html = renderToStaticMarkup(sectionOf({ state: EPodState.Parked, series: [] }))
    expect(html).toContain('aria-label="Start pod"')
    expect(html).not.toContain('aria-label="Stop pod"')
  })

  it('shows the disk row and the grow control on an Agent37 pod', () => {
    const html = renderToStaticMarkup(sectionOf({ agent37: true, series: [diskSample()] }))
    expect(html).toContain('Disk')
    expect(html).toContain('14.2 / 20 GB')
    expect(html).toContain('aria-label="Increase disk"')
  })

  it('keeps the grow control off a pod whose provider has no disk to grow', () => {
    const html = renderToStaticMarkup(sectionOf({ agent37: false, series: [diskSample()] }))
    expect(html).toContain('Disk')
    expect(html).not.toContain('aria-label="Increase disk"')
  })

  it('does not echo the pending size below the chart', () => {
    const html = renderToStaticMarkup(sectionOf({ pendingShape: { vcpus: 8, memoryGb: 64 } }))
    expect(html).toContain('Resizing…')
    expect(html.indexOf('Resizing…')).toBeLessThan(html.indexOf('CPU'))
    expect(html.match(/8 vCPU · 64 GB/g)).toHaveLength(1)
  })

  it('asks before stopping a working pod', async () => {
    const unmount = await mount(sectionOf({ power: powerOf('confirm') }))
    expect(document.body.textContent).toContain('Stop the pod?')
    expect(document.body.textContent).toContain('Keep working')
    expect(buttonNamed('Stop')).toBeDefined()
    await unmount()
  })

  it('shows the stop in flight and disables the power button', () => {
    const html = renderToStaticMarkup(sectionOf({ power: powerOf('sleeping') }))
    expect(html).toContain('aria-label="Stopping pod"')
    expect(html).toContain('disabled')
  })
})

describe('pod resize confirmation', () => {
  it('applies the picked shape at once when nothing is running', async () => {
    const onResize = mock((_request: PodShapeRequest) => Promise.resolve())
    const unmount = await mount(<Harness view={viewModelFixture()} onResize={onResize} />)
    await click(buttonNamed('start'))
    expect(onResize).toHaveBeenCalledWith({
      shape: { vcpus: 8, memoryGb: 64 },
      whenIdle: false,
    })
    expect(document.body.textContent).toContain('applied')
    await unmount()
  })

  it('asks first with a running shell and names what is running', async () => {
    const onResize = mock((_request: PodShapeRequest) => Promise.resolve())
    const unmount = await mount(<Harness view={populatedPaneValue().view} onResize={onResize} />)
    await click(buttonNamed('start'))
    expect(document.body.textContent).toContain('asking')
    expect(document.body.textContent).toContain('1 shell')
    expect(onResize).not.toHaveBeenCalled()
    await unmount()
  })

  it('asks the server to wait for idle on wait until idle', async () => {
    const onResize = mock((_request: PodShapeRequest) => Promise.resolve())
    const unmount = await mount(<Harness view={populatedPaneValue().view} onResize={onResize} />)
    await click(buttonNamed('start'))
    await click(buttonNamed('Wait until idle'))
    expect(onResize).toHaveBeenCalledWith({
      shape: { vcpus: 8, memoryGb: 64 },
      whenIdle: true,
    })
    await unmount()
  })

  it('declines quietly when the confirmation is cancelled', async () => {
    const onResize = mock((_request: PodShapeRequest) => Promise.resolve())
    const unmount = await mount(<Harness view={populatedPaneValue().view} onResize={onResize} />)
    await click(buttonNamed('start'))
    await click(buttonNamed('Cancel'))
    expect(onResize).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('declined')
    await unmount()
  })

  it('asks first with a running service', async () => {
    const view = viewModelFixture({ previews: [previewFixture] })
    const unmount = await mount(<Harness view={view} onResize={mock(() => Promise.resolve())} />)
    await click(buttonNamed('start'))
    expect(document.body.textContent).toContain('asking')
    expect(document.body.textContent).toContain('1 service')
    await unmount()
  })

  it('names the shells and services stop in the v2 dialog', () => {
    expect(POD_RESTART_BODY).toBe(
      'Running shells and services stop while the sandbox restarts. Files are kept and the agent keeps working.',
    )
  })
})

function Harness(props: {
  view: ReturnType<typeof viewModelFixture>
  status?: BusyStatus | undefined
  onResize: (request: PodShapeRequest) => Promise<void>
}) {
  const { confirmation, handleResize } = useShapeResizeConfirmation({
    busy: podBusyOfView({ view: props.view, status: props.status }),
    onResize: props.onResize,
  })
  const [outcome, setOutcome] = useState('pending')
  const handleStart = () =>
    handleResize({ vcpus: 8, memoryGb: 64 }).then(
      () => setOutcome('applied'),
      (failure: unknown) =>
        setOutcome(failure instanceof ResizeDeclinedError ? 'declined' : 'failed'),
    )
  return (
    <>
      <button type="button" onClick={handleStart}>
        start
      </button>
      <output>{outcome}</output>
      <output>{confirmation === null ? 'closed' : 'asking'}</output>
      <ResizeBusyDialog confirmation={confirmation} body={POD_RESTART_BODY} />
    </>
  )
}

describe('disk grow confirmation', () => {
  it('names the target disk while it asks and waits for idle when told to', async () => {
    const onGrow = mock((_request: PodDiskRequest) => Promise.resolve())
    const unmount = await mount(<DiskHarness view={populatedPaneValue().view} onGrow={onGrow} />)
    await click(buttonNamed('grow'))
    expect(document.body.textContent).toContain(
      'The pod restarts with a 30 GB disk. Files are kept.',
    )
    expect(onGrow).not.toHaveBeenCalled()
    await click(buttonNamed('Wait until idle'))
    expect(onGrow).toHaveBeenCalledWith({ diskGb: 30, whenIdle: true })
    await unmount()
  })

  it('grows at once when nothing is running', async () => {
    const onGrow = mock((_request: PodDiskRequest) => Promise.resolve())
    const unmount = await mount(<DiskHarness view={viewModelFixture()} onGrow={onGrow} />)
    await click(buttonNamed('grow'))
    expect(onGrow).toHaveBeenCalledWith({ diskGb: 30, whenIdle: false })
    await unmount()
  })

  it('asks before growing while the setup script runs', async () => {
    const onGrow = mock((_request: PodDiskRequest) => Promise.resolve())
    const unmount = await mount(
      <DiskHarness
        view={viewModelFixture()}
        status={{ state: ESessionStatus.Idle, setupRunning: true }}
        onGrow={onGrow}
      />,
    )
    await click(buttonNamed('grow'))
    expect(document.body.textContent).toContain('Setup script running.')
    expect(onGrow).not.toHaveBeenCalled()
    await unmount()
  })
})

function DiskHarness(props: {
  view: ReturnType<typeof viewModelFixture>
  status?: BusyStatus | undefined
  onGrow: (request: PodDiskRequest) => Promise<void>
}) {
  const { confirmation, handleGrow } = useDiskResizeConfirmation({
    busy: podBusyOfView({ view: props.view, status: props.status }),
    onResize: props.onGrow,
  })
  const handleClick = () => {
    handleGrow(30).catch(() => undefined)
  }
  return (
    <>
      <button type="button" onClick={handleClick}>
        grow
      </button>
      <ResizeBusyDialog confirmation={confirmation} />
    </>
  )
}

describe('resizePod', () => {
  it('posts the shape and the wait choice', async () => {
    const command = mock(() => Promise.resolve({}))
    await resizePod({
      api: { command },
      sessionId: 'ses-1',
      vcpus: 8,
      memoryGb: 64,
      whenIdle: true,
    })
    expect(command).toHaveBeenCalledWith({
      sessionId: 'ses-1',
      name: 'resize',
      args: { vcpus: 8, memoryGb: 64, whenIdle: true },
    })
  })

  it('posts the bigger disk beside the shape the pod already runs at', async () => {
    const command = mock(() => Promise.resolve({}))
    await resizePod({
      api: { command },
      sessionId: 'ses-1',
      vcpus: 4,
      memoryGb: 16,
      diskGb: 30,
      whenIdle: false,
    })
    expect(command).toHaveBeenCalledWith({
      sessionId: 'ses-1',
      name: 'resize',
      args: { vcpus: 4, memoryGb: 16, diskGb: 30, whenIdle: false },
    })
  })
})

describe('podBusyOfView', () => {
  it('is idle with no shells and no services', () => {
    expect(podBusyOfView({ view: paneValueFixture().view, status: undefined })).toEqual({
      busy: false,
      running: [],
    })
  })

  it('is busy with a running shell or a running service', () => {
    expect(podBusyOfView({ view: populatedPaneValue().view, status: undefined }).busy).toBe(true)
  })

  it('counts a turn in flight and a running setup script', () => {
    expect(
      podBusyOfView({ view: paneValueFixture().view, status: { state: ESessionStatus.Thinking } })
        .running,
    ).toEqual(['Agent turn'])
    expect(
      podBusyOfView({ view: paneValueFixture().view, status: { state: ESessionStatus.Preparing } })
        .running,
    ).toEqual(['Setup script'])
  })

  it('counts a background setup script whose session is idle', () => {
    expect(
      podBusyOfView({
        view: paneValueFixture().view,
        status: { state: ESessionStatus.Idle, setupRunning: true },
      }),
    ).toEqual({ busy: true, running: ['Setup script'] })
  })
})
