import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { EPodState, ResizeDeclinedError, type PodStatus } from '../pod-status'
import { PodPopoverBody } from '../internal/pod-popover-body'
import { PodStatusChip } from '../pod-status-chip'
import { vcpuSizeItems } from '../vcpu-size-select'

const RUNNING: PodStatus = {
  state: EPodState.Running,
  vcpus: 4,
  podId: 'pod_1',
  region: 'iad1',
}

const SIZES = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32]

describe('PodStatusChip markup', () => {
  it('labels the trigger with the size while running', () => {
    expect(renderToStaticMarkup(<PodStatusChip status={RUNNING} sizes={SIZES} />)).toContain(
      '4 vCPU · 8 GB',
    )
  })

  it('labels the trigger with the state while parked', () => {
    const html = renderToStaticMarkup(
      <PodStatusChip status={{ ...RUNNING, state: EPodState.Parked }} sizes={SIZES} />,
    )
    expect(html).toContain('Parked')
  })

  it('lists every size from 1 to 32 with its RAM', () => {
    expect(vcpuSizeItems({ sizes: SIZES })).toEqual(
      SIZES.map((vcpus) => ({
        value: String(vcpus),
        label: `${vcpus} vCPU`,
        detail: `${vcpus * 2} GB RAM`,
      })),
    )
  })

  it('puts the leading options ahead of the sizes', () => {
    const [first] = vcpuSizeItems({
      sizes: SIZES,
      options: [{ value: 'default', label: 'Account default', detail: 'Uses your Sandbox size' }],
    })
    expect(first).toMatchObject({ value: 'default', label: 'Account default' })
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
    return {
      container,
      unmount: async () => {
        await act(async () => root.unmount())
        container.remove()
      },
    }
  }

  const click = (element: Element | null | undefined) =>
    act(async () => {
      element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

  const buttonNamed = (container: Element, name: string) =>
    [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(name))

  type Fiber = { memoizedProps?: Record<string, unknown>; return: Fiber | null }

  const selectOnValueChangeOf = (node: Element): ((value: unknown) => void) | undefined => {
    const key = Object.keys(node).find((name) => name.startsWith('__reactFiber$'))
    if (key === undefined) return undefined
    let fiber: Fiber | null = (node as unknown as Record<string, Fiber>)[key] ?? null
    while (fiber !== null) {
      const candidate = fiber.memoizedProps?.onValueChange
      if (typeof candidate === 'function') return candidate as (value: unknown) => void
      fiber = fiber.return
    }
    return undefined
  }

  // Base UI select popups never mount in happy-dom, so pick through the Select
  // root's onValueChange, reached from the trigger's React fiber.
  const chooseSize = async (container: Element, vcpus: number) => {
    const trigger = container.querySelector('button[aria-label="vCPUs"]')
    if (trigger === null) throw new Error('no vCPUs trigger')
    const onValueChange = selectOnValueChangeOf(trigger)
    if (onValueChange === undefined) throw new Error('no onValueChange above the trigger')
    await act(async () => {
      onValueChange(String(vcpus))
    })
  }

  const bodyProps = { status: RUNNING, sizes: SIZES }

  it('shows the current size in the select trigger', async () => {
    const view = await mount(
      <PodPopoverBody {...bodyProps} onResize={mock(() => Promise.resolve())} />,
    )
    const trigger = view.container.querySelector('button[aria-label="vCPUs"]')
    expect(trigger?.textContent).toContain('4')
    await view.unmount()
  })

  it('calls onResize with the chosen vCPUs and then shows the pending note', async () => {
    const onResize = mock(() => Promise.resolve())
    const view = await mount(<PodPopoverBody {...bodyProps} onResize={onResize} />)
    await chooseSize(view.container, 8)
    await click(buttonNamed(view.container, 'Apply'))
    expect(onResize).toHaveBeenCalledWith(8)
    expect(view.container.textContent).toContain('Restarting with 8 vCPU · 16 GB')
    expect(view.container.textContent).not.toContain('next wake')
    await view.unmount()
  })

  it('says a parked pod takes the size when it next starts', async () => {
    const onResize = mock(() => Promise.resolve())
    const parked = { ...RUNNING, state: EPodState.Parked }
    const view = await mount(<PodPopoverBody status={parked} sizes={SIZES} onResize={onResize} />)
    expect(view.container.textContent).toContain('Applies on next start')
    await chooseSize(view.container, 8)
    await click(buttonNamed(view.container, 'Apply'))
    expect(view.container.textContent).toContain('Starts with 8 vCPU · 16 GB')
    await view.unmount()
  })

  it('warns that applying restarts a running pod and names the plan caps', async () => {
    const view = await mount(
      <PodPopoverBody
        {...bodyProps}
        onResize={mock(() => Promise.resolve())}
        planCapHint="Hobby up to 4 vCPU · Pro up to 8 · Enterprise up to 32"
      />,
    )
    expect(view.container.textContent).toContain('Applying restarts the pod')
    expect(view.container.textContent).toContain('Enterprise up to 32')
    await view.unmount()
  })

  it('stays quiet when the resize is declined', async () => {
    const onResize = mock(() => Promise.reject(new ResizeDeclinedError()))
    const view = await mount(<PodPopoverBody {...bodyProps} onResize={onResize} />)
    await chooseSize(view.container, 8)
    await click(buttonNamed(view.container, 'Apply'))
    expect(view.container.textContent).not.toContain('Could not resize the pod.')
    expect(view.container.textContent).not.toContain('Restarting with')
    await view.unmount()
  })

  it('reports a failed resize with the provider message', async () => {
    const onResize = mock(() => Promise.reject(new Error('vCPUs above 8 need an Enterprise plan')))
    const view = await mount(<PodPopoverBody {...bodyProps} onResize={onResize} />)
    await chooseSize(view.container, 2)
    await click(buttonNamed(view.container, 'Apply'))
    expect(view.container.textContent).toContain('Could not resize the pod.')
    expect(view.container.textContent).toContain('Enterprise plan')
    await view.unmount()
  })

  it('keeps showing an owed restart after the popover remounts, with Apply locked', async () => {
    const restarting = { ...RUNNING, state: EPodState.Resuming, pendingVcpus: 8 }
    const first = await mount(
      <PodPopoverBody status={restarting} sizes={SIZES} onResize={mock(() => Promise.resolve())} />,
    )
    await first.unmount()
    const view = await mount(
      <PodPopoverBody status={restarting} sizes={SIZES} onResize={mock(() => Promise.resolve())} />,
    )
    expect(view.container.textContent).toContain('Restarting with 8 vCPU · 16 GB')
    expect(buttonNamed(view.container, 'Apply')?.disabled).toBe(true)
    await view.unmount()
  })

  it('follows the server once the restart lands', async () => {
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const onResize = mock(() => Promise.resolve())
    await act(async () =>
      root.render(
        <PodPopoverBody
          status={{ ...RUNNING, pendingVcpus: 8 }}
          sizes={SIZES}
          onResize={onResize}
        />,
      ),
    )
    await act(async () =>
      root.render(
        <PodPopoverBody status={{ ...RUNNING, vcpus: 8 }} sizes={SIZES} onResize={onResize} />,
      ),
    )
    expect(container.textContent).not.toContain('Restarting with')
    expect(container.textContent).toContain('RAM 16 GB')
    await act(async () => root.unmount())
  })
})
