import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { EPodState, ResizeDeclinedError } from '@dltech/atlas-ui/ai/pod-status-chip'
import { ESandboxStatus } from '@dltech/atlas-protocol'

import {
  POD_RESTART_BODY,
  ResizeBusyDialog,
  useShapeResizeConfirmation,
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

const sectionOf = (overrides: Partial<React.ComponentProps<typeof PodPaneSection>> = {}) => (
  <PodPaneSection
    state={EPodState.Running}
    shape={{ vcpus: 4, memoryGb: 16 }}
    shapes={[
      { vcpus: 2, memoryGb: 4 },
      { vcpus: 4, memoryGb: 16 },
    ]}
    unavailable={[]}
    series={[sample()]}
    power={powerOf()}
    onStart={() => undefined}
    onStop={() => undefined}
    onConfirm={() => undefined}
    onCancel={() => undefined}
    onResize={() => undefined}
    {...overrides}
  />
)

describe('podSectionViewOf', () => {
  it('renders nothing without pushed pod state', () => {
    expect(podSectionViewOf({ pod: undefined, live: true })).toBeNull()
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
      pendingShape: { vcpus: 8, memoryGb: 64 },
    })
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

  it('keeps the idle placeholder without a series', () => {
    const running = renderToStaticMarkup(sectionOf({ series: [] }))
    expect(running).toContain('CPU')
    expect(running).not.toContain('No live usage')
    const asleep = renderToStaticMarkup(sectionOf({ series: [], state: EPodState.Parked }))
    expect(asleep).toContain('No live usage — pod asleep')
  })

  it('keeps the throttle and OOM signals from the latest sample', () => {
    const html = renderToStaticMarkup(
      sectionOf({ series: [sample({ throttled: true, oomKills: 2 })] }),
    )
    expect(html).toContain('Throttled')
    expect(html).toContain('2 OOM kills')
  })

  it('offers to start a parked pod instead of stopping it', () => {
    const html = renderToStaticMarkup(sectionOf({ state: EPodState.Parked, series: [] }))
    expect(html).toContain('aria-label="Start pod"')
    expect(html).not.toContain('aria-label="Stop pod"')
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
  onResize: (request: PodShapeRequest) => Promise<void>
}) {
  const { confirmation, handleResize } = useShapeResizeConfirmation({
    busy: podBusyOfView(props.view, undefined),
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
})

describe('podBusyOfView', () => {
  it('is idle with no shells and no services', () => {
    expect(podBusyOfView(paneValueFixture().view, 'idle')).toEqual({ busy: false, running: [] })
  })

  it('is busy with a running shell or a running service', () => {
    expect(podBusyOfView(populatedPaneValue().view, 'idle').busy).toBe(true)
  })

  it('counts a turn in flight and a running setup script', () => {
    expect(podBusyOfView(paneValueFixture().view, 'thinking').running).toEqual(['Agent turn'])
    expect(podBusyOfView(paneValueFixture().view, 'preparing').running).toEqual(['Setup script'])
  })
})
