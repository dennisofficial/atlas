import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { PodBusy } from '@dltech/atlas-core'
import { ResizeDeclinedError } from '@dltech/atlas-ui/ai/pod-status-chip'

import {
  POD_RESTART_BODY,
  ResizeBusyDialog,
  useResizeConfirmation,
  type ResizeRequest,
} from '@/features/pods/pod-resize-confirmation'

import { resizePod } from '../../data/pod-resources'
import { PLATFORM_POD_SIZES, PodStatusSection, podBusyOfView } from '../details/pod-section'
import { paneValueFixture, previewFixture, populatedPaneValue, viewModelFixture } from './fixture'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
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

const idle: PodBusy = { busy: false, running: [] }

const sectionOf = (args: {
  onResize: (request: ResizeRequest) => Promise<void>
  busy?: PodBusy
}): React.ReactElement => (
  <PodStatusSection
    pod={{ desiredVcpus: 2, actualVcpus: 2, phase: 'steady' }}
    live
    busy={args.busy ?? idle}
    settingsHref="/settings/usage-sandboxes"
    onResize={args.onResize}
  />
)

function Harness(props: {
  view: ReturnType<typeof viewModelFixture>
  onResize: (request: ResizeRequest) => Promise<void>
}) {
  const { confirmation, handleResize } = useResizeConfirmation({
    busy: podBusyOfView(props.view, undefined),
    onResize: props.onResize,
  })
  const [outcome, setOutcome] = useState('pending')
  const handleStart = () =>
    handleResize(8).then(
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

describe('PLATFORM_POD_SIZES', () => {
  it('offers the 2, 4 and 8 vCPU sizes every platform sandbox runs at', () => {
    expect(PLATFORM_POD_SIZES).toEqual([2, 4, 8])
  })
})

describe('PodStatusSection', () => {
  it('renders nothing without pushed pod state', async () => {
    const unmount = await mount(
      <PodStatusSection
        pod={undefined}
        live
        busy={idle}
        settingsHref="/settings/usage-sandboxes"
        onResize={async () => undefined}
      />,
    )
    expect(document.body.querySelector('[data-session-pod]')).toBeNull()
    expect(document.body.textContent).toBe('')
    await unmount()
  })

  it('shows the size of a live pod', () => {
    const html = renderToStaticMarkup(sectionOf({ onResize: async () => undefined }))
    expect(html).toContain('aria-label="Pod"')
    expect(html).toContain('2 vCPU · 4 GB')
  })

  it('shows the resize in flight with its target size', () => {
    const html = renderToStaticMarkup(
      <PodStatusSection
        pod={{ desiredVcpus: 8, actualVcpus: 2, phase: 'resizing' }}
        live
        busy={idle}
        settingsHref="/settings/usage-sandboxes"
        onResize={async () => undefined}
      />,
    )
    expect(html).toContain('Resizing · 8 vCPU · 16 GB')
  })

  it('names a failed resize on the chip', () => {
    const html = renderToStaticMarkup(
      <PodStatusSection
        pod={{
          desiredVcpus: 8,
          actualVcpus: 2,
          phase: 'failed',
          error: 'vCPUs above 8 need an Enterprise plan',
        }}
        live
        busy={idle}
        settingsHref="/settings/usage-sandboxes"
        onResize={async () => undefined}
      />,
    )
    expect(html).toContain('Resize failed')
  })

  it('names the sandbox provider of the session', () => {
    const html = renderToStaticMarkup(
      <PodStatusSection
        pod={{ desiredVcpus: 2, actualVcpus: 2, phase: 'steady' }}
        live
        busy={idle}
        sandboxProvider="agent37"
        settingsHref="/settings/usage-sandboxes"
        onResize={async () => undefined}
      />,
    )
    expect(html).toContain('data-sandbox-provider="agent37"')
    expect(html).toContain('Agent37')
  })

  it('asks only when the pod waits on a parked session', () => {
    const html = renderToStaticMarkup(
      <PodStatusSection
        pod={{ desiredVcpus: 2, actualVcpus: 2, phase: 'steady' }}
        live={false}
        busy={idle}
        settingsHref="/settings/usage-sandboxes"
        onResize={async () => undefined}
      />,
    )
    expect(html).toContain('Parked')
  })
})

describe('pod resize confirmation', () => {
  it('applies at once when nothing is running', async () => {
    const onResize = mock(() => Promise.resolve())
    const unmount = await mount(<Harness view={viewModelFixture()} onResize={onResize} />)
    await click(buttonNamed('start'))
    expect(onResize).toHaveBeenCalledWith({ vcpus: 8, whenIdle: false })
    expect(document.body.textContent).toContain('closed')
    expect(document.body.textContent).toContain('applied')
    await unmount()
  })

  it('asks first with a running shell and names what is running', async () => {
    const onResize = mock(() => Promise.resolve())
    const unmount = await mount(<Harness view={populatedPaneValue().view} onResize={onResize} />)
    await click(buttonNamed('start'))
    expect(document.body.textContent).toContain('asking')
    expect(document.body.textContent).toContain('1 shell')
    expect(onResize).not.toHaveBeenCalled()
    await unmount()
  })

  it('offers cancel, wait and force restart on a busy pod', async () => {
    const unmount = await mount(
      <Harness view={populatedPaneValue().view} onResize={mock(() => Promise.resolve())} />,
    )
    await click(buttonNamed('start'))
    expect(buttonNamed('Cancel')).toBeDefined()
    expect(buttonNamed('Wait until idle')).toBeDefined()
    expect(buttonNamed('Force restart')).toBeDefined()
    await unmount()
  })

  it('resizes now on force restart', async () => {
    const onResize = mock(() => Promise.resolve())
    const unmount = await mount(<Harness view={populatedPaneValue().view} onResize={onResize} />)
    await click(buttonNamed('start'))
    await click(buttonNamed('Force restart'))
    expect(onResize).toHaveBeenCalledWith({ vcpus: 8, whenIdle: false })
    expect(document.body.textContent).toContain('applied')
    await unmount()
  })

  it('asks the server to wait for idle on wait until idle', async () => {
    const onResize = mock(() => Promise.resolve())
    const unmount = await mount(<Harness view={populatedPaneValue().view} onResize={onResize} />)
    await click(buttonNamed('start'))
    await click(buttonNamed('Wait until idle'))
    expect(onResize).toHaveBeenCalledWith({ vcpus: 8, whenIdle: true })
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

  it('declines quietly when the confirmation is cancelled', async () => {
    const onResize = mock(() => Promise.resolve())
    const unmount = await mount(<Harness view={populatedPaneValue().view} onResize={onResize} />)
    await click(buttonNamed('start'))
    await click(buttonNamed('Cancel'))
    expect(onResize).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('declined')
    await unmount()
  })

  it('names the shells and services stop in the v2 dialog', () => {
    expect(POD_RESTART_BODY).toBe(
      'Running shells and services stop while the sandbox restarts. Files are kept and the agent keeps working.',
    )
  })
})

describe('resizePod', () => {
  it('posts the resize command with the wait choice', async () => {
    const command = mock(() => Promise.resolve({}))
    await resizePod({ api: { command }, sessionId: 'ses-1', vcpus: 8, whenIdle: true })
    expect(command).toHaveBeenCalledWith({
      sessionId: 'ses-1',
      name: 'resize',
      args: { vcpus: 8, whenIdle: true },
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
