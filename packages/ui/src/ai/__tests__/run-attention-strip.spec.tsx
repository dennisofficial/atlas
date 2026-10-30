import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'

import { RunAttentionStrip, type RunAttentionAction } from '../run-attention-strip'
import { RunFailedMarker } from '../run-failed-marker'

const action = (overrides: Partial<RunAttentionAction> & { id: string }): RunAttentionAction => ({
  label: overrides.id,
  primary: false,
  disabled: false,
  onSelect: () => {},
  ...overrides,
})

describe('RunAttentionStrip', () => {
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

  const buttons = (container: Element) => [...container.querySelectorAll('button')]

  it('renders a labelled section with title, detail and meta', async () => {
    const view = await mount(
      <RunAttentionStrip title="Rate limited" detail="Wait" meta="1s" actions={[]} />,
    )
    expect(view.container.querySelector('section[aria-label="Run failure"]')).not.toBeNull()
    expect(view.container.textContent).toContain('Rate limited')
    expect(view.container.textContent).toContain('Wait')
    expect(view.container.textContent).toContain('1s')
    await view.unmount()
  })

  it('renders actions in order and fires onSelect', async () => {
    const onFix = mock(() => {})
    const onRetry = mock(() => {})
    const view = await mount(
      <RunAttentionStrip
        title="t"
        detail="d"
        actions={[
          action({ id: 'fix', label: 'Fix', primary: true, onSelect: onFix }),
          action({ id: 'retry', label: 'Retry', onSelect: onRetry }),
        ]}
      />,
    )
    const [first, second] = buttons(view.container)
    expect([first?.textContent, second?.textContent]).toEqual(['Fix', 'Retry'])
    expect(first?.getAttribute('class')).toContain('bg-primary')
    expect(second?.getAttribute('class')).not.toContain('bg-primary ')
    await click(first)
    await click(second)
    expect(onFix).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledTimes(1)
    await view.unmount()
  })

  it('disables actions with the busy reason as title and replaces the detail', async () => {
    const onSelect = mock(() => {})
    const view = await mount(
      <RunAttentionStrip
        title="t"
        detail="the detail"
        busyReason="Run in progress"
        actions={[action({ id: 'retry', label: 'Retry', disabled: true, onSelect })]}
      />,
    )
    const [retry] = buttons(view.container)
    expect(retry?.hasAttribute('disabled')).toBe(true)
    expect(retry?.getAttribute('title')).toBe('Run in progress')
    expect(view.container.textContent).toContain('Run in progress')
    expect(view.container.textContent).not.toContain('the detail')
    await click(retry)
    expect(onSelect).not.toHaveBeenCalled()
    await view.unmount()
  })

  it('shows the pending label, disabled and without a busy title', async () => {
    const view = await mount(
      <RunAttentionStrip
        title="t"
        detail="d"
        busyReason="Run in progress"
        actions={[
          action({
            id: 'retry',
            label: 'Retry',
            disabled: true,
            pending: true,
            pendingLabel: 'Retrying…',
          }),
        ]}
      />,
    )
    const [retry] = buttons(view.container)
    expect(retry?.textContent).toBe('Retrying…')
    expect(retry?.hasAttribute('disabled')).toBe(true)
    expect(retry?.hasAttribute('title')).toBe(false)
    await view.unmount()
  })

  it('fires onDismiss from the labelled dismiss button', async () => {
    const onDismiss = mock(() => {})
    const view = await mount(
      <RunAttentionStrip title="t" detail="d" actions={[]} onDismiss={onDismiss} />,
    )
    await click(view.container.querySelector('button[aria-label="Dismiss"]'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    await view.unmount()
  })

  it('has no dismiss button without onDismiss', async () => {
    const view = await mount(<RunAttentionStrip title="t" detail="d" actions={[]} />)
    expect(view.container.querySelector('button[aria-label="Dismiss"]')).toBeNull()
    await view.unmount()
  })
})

describe('RunFailedMarker', () => {
  it('renders the label after a cross', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const html = renderToStaticMarkup(<RunFailedMarker label="run failed after 1.2s" />)
    expect(html).toContain('✗ run failed after 1.2s')
  })
})
