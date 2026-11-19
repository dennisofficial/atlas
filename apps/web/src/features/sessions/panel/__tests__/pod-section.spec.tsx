import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ResizeDeclinedError } from '@dltech/atlas-ui/ai/pod-status-chip'
import { EVercelPlan } from '@dltech/atlas-wire/web'

import {
  POD_RESTART_BODY,
  RestartConfirmDialog,
  useResizeConfirmation,
} from '@/features/pods/pod-resize-confirmation'

import { resizePod } from '../../data/pod-resources'
import { podBusyOf, PodStatusSection } from '../details/pod-section'
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

const sectionOf = (args: {
  onResize: (vcpus: number) => Promise<void>
  busy?: boolean
}): React.ReactElement => (
  <PodStatusSection
    pod={{ desiredVcpus: 2, actualVcpus: 2, phase: 'steady' }}
    live
    busy={args.busy ?? false}
    plan={EVercelPlan.Unknown}
    settingsHref="/settings/usage-sandboxes"
    onResize={args.onResize}
  />
)

function Harness(props: {
  view: ReturnType<typeof viewModelFixture>
  onResize: (vcpus: number) => Promise<void>
}) {
  const { confirmation, handleResize } = useResizeConfirmation({
    busy: podBusyOf(props.view),
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
      <button type="button" onClick={() => confirmation?.accept()}>
        accept
      </button>
      <RestartConfirmDialog confirmation={confirmation} body={POD_RESTART_BODY} />
    </>
  )
}

describe('PodStatusSection', () => {
  it('renders nothing without pushed pod state', async () => {
    const unmount = await mount(
      <PodStatusSection
        pod={undefined}
        live
        busy
        plan={EVercelPlan.Unknown}
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
        busy={false}
        plan={EVercelPlan.Unknown}
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
        busy={false}
        plan={EVercelPlan.Unknown}
        settingsHref="/settings/usage-sandboxes"
        onResize={async () => undefined}
      />,
    )
    expect(html).toContain('Resize failed')
  })

  it('asks only when the pod waits on a parked session', () => {
    const html = renderToStaticMarkup(
      <PodStatusSection
        pod={{ desiredVcpus: 2, actualVcpus: 2, phase: 'steady' }}
        live={false}
        busy={false}
        plan={EVercelPlan.Unknown}
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
    expect(onResize).toHaveBeenCalledWith(8)
    expect(document.body.textContent).toContain('closed')
    expect(document.body.textContent).toContain('applied')
    await unmount()
  })

  it('asks first with a running shell and resizes only on Restart', async () => {
    const onResize = mock(() => Promise.resolve())
    const unmount = await mount(<Harness view={populatedPaneValue().view} onResize={onResize} />)
    await click(buttonNamed('start'))
    expect(document.body.textContent).toContain('asking')
    expect(onResize).not.toHaveBeenCalled()
    await click(buttonNamed('accept'))
    expect(onResize).toHaveBeenCalledWith(8)
    expect(document.body.textContent).toContain('applied')
    await unmount()
  })

  it('asks first with a running service', async () => {
    const view = viewModelFixture({ previews: [previewFixture] })
    const unmount = await mount(<Harness view={view} onResize={mock(() => Promise.resolve())} />)
    await click(buttonNamed('start'))
    expect(document.body.textContent).toContain('asking')
    await unmount()
  })

  it('declines quietly when the confirmation is cancelled', async () => {
    const onResize = mock(() => Promise.resolve())
    const unmount = await mount(<Harness view={populatedPaneValue().view} onResize={onResize} />)
    await click(buttonNamed('start'))
    await click(buttonNamed('Keep working'))
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
  it('posts the resize command for the session', async () => {
    const command = mock(() => Promise.resolve({}))
    await resizePod({ api: { command }, sessionId: 'ses-1', vcpus: 8 })
    expect(command).toHaveBeenCalledWith({ sessionId: 'ses-1', name: 'resize', args: { vcpus: 8 } })
  })
})

describe('podBusyOf', () => {
  it('is idle with no shells and no services', () => {
    expect(podBusyOf(paneValueFixture().view)).toBe(false)
  })

  it('is busy with a running shell or a running service', () => {
    expect(podBusyOf(populatedPaneValue().view)).toBe(true)
  })
})
