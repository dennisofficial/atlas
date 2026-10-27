import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { EPodState, ResizeDeclinedError, type PodStatus } from '../pod-status'
import { PodPopoverBody } from '../internal/pod-popover-body'
import { PodStatusChip } from '../pod-status-chip'

const RUNNING: PodStatus = {
  state: EPodState.Running,
  vcpus: 4,
  podId: 'pod_1',
  region: 'iad1',
}

describe('PodStatusChip markup', () => {
  it('labels the trigger with the size while running', () => {
    expect(renderToStaticMarkup(<PodStatusChip status={RUNNING} />)).toContain('4 vCPU · 8 GB')
  })

  it('labels the trigger with the state while parked', () => {
    const html = renderToStaticMarkup(
      <PodStatusChip status={{ ...RUNNING, state: EPodState.Parked }} />,
    )
    expect(html).toContain('Parked')
  })
})

describe('PodStatusChip resize', () => {
  beforeAll(() => {
    GlobalRegistrator.register()
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  afterAll(async () => {
    await GlobalRegistrator.unregister()
  })

  const mount = async (element: React.ReactElement) => {
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => root.render(element))
    return { container, unmount: () => act(async () => root.unmount()) }
  }

  const click = (element: Element | null | undefined) =>
    act(async () => {
      element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

  const buttonNamed = (name: string) =>
    [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes(name),
    )

  it('calls onResize with the chosen vCPUs and then shows the pending note', async () => {
    const onResize = mock(() => Promise.resolve())
    const view = await mount(<PodPopoverBody status={RUNNING} onResize={onResize} />)
    await click(buttonNamed('8 vCPU'))
    await click(buttonNamed('Apply'))
    expect(onResize).toHaveBeenCalledWith(8)
    expect(document.body.textContent).toContain('Restarting with 8 vCPU · 16 GB')
    expect(document.body.textContent).not.toContain('next wake')
    await view.unmount()
  })

  it('says a parked pod takes the size when it next starts', async () => {
    const onResize = mock(() => Promise.resolve())
    const parked = { ...RUNNING, state: EPodState.Parked }
    const view = await mount(<PodPopoverBody status={parked} onResize={onResize} />)
    expect(document.body.textContent).toContain('Applies on next start')
    await click(buttonNamed('8 vCPU'))
    await click(buttonNamed('Apply'))
    expect(document.body.textContent).toContain('Starts with 8 vCPU · 16 GB')
    await view.unmount()
  })

  it('warns that applying restarts a running pod', async () => {
    const view = await mount(
      <PodPopoverBody status={RUNNING} onResize={mock(() => Promise.resolve())} />,
    )
    expect(document.body.textContent).toContain('Applying restarts the pod')
    await view.unmount()
  })

  it('stays quiet when the resize is declined', async () => {
    const onResize = mock(() => Promise.reject(new ResizeDeclinedError()))
    const view = await mount(<PodPopoverBody status={RUNNING} onResize={onResize} />)
    await click(buttonNamed('8 vCPU'))
    await click(buttonNamed('Apply'))
    expect(document.body.textContent).not.toContain('Could not resize the pod.')
    expect(document.body.textContent).not.toContain('Restarting with')
    await view.unmount()
  })

  it('reports a failed resize', async () => {
    const onResize = mock(() => Promise.reject(new Error('quota')))
    const view = await mount(<PodPopoverBody status={RUNNING} onResize={onResize} />)
    await click(buttonNamed('2 vCPU'))
    await click(buttonNamed('Apply'))
    expect(document.body.textContent).toContain('Could not resize the pod.')
    await view.unmount()
  })
})
