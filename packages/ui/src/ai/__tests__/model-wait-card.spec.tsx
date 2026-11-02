import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'

import {
  EModelWaitNoteTone,
  ModelWaitCard,
  type ModelWaitAction,
  type ModelWaitCardProps,
} from '../model-wait-card'

const action = (overrides: Partial<ModelWaitAction> & { id: string }): ModelWaitAction => ({
  label: overrides.id,
  primary: false,
  disabled: false,
  onSelect: () => undefined,
  ...overrides,
})

const propsOf = (actions: ModelWaitAction[], extra: Partial<ModelWaitCardProps> = {}) =>
  ({
    title: 'Waiting for model',
    announcement: 'Waiting for model: Anthropic · Work: allowance exhausted.',
    issues: [
      {
        id: 'one',
        detail: 'Anthropic · Work: allowance exhausted. Provider reset: not supplied.',
        meta: 'Last checked now',
        affectedLabel: '1 session waiting',
        affected: [{ id: 'a', label: 'Root' }],
        actions,
      },
    ],
    ...extra,
  }) satisfies ModelWaitCardProps

describe('ModelWaitCard', () => {
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
  const named = (container: Element, label: string) =>
    buttons(container).find((button) => button.textContent?.trim() === label)

  it('names the region by its heading and announces once through a status node', async () => {
    const { container, unmount } = await mount(<ModelWaitCard {...propsOf([])} />)
    const section = container.querySelector('section')
    const heading = container.querySelector('h3')
    expect(section?.getAttribute('aria-labelledby')).toBe(heading?.id ?? 'missing')
    expect(heading?.textContent).toBe('Waiting for model')
    const status = container.querySelectorAll('[role="status"]')
    expect(status).toHaveLength(1)
    expect(status[0]?.textContent).toContain('allowance exhausted')
    await unmount()
  })

  it('runs an action without a confirm directly', async () => {
    const onSelect = mock(() => undefined)
    const { container, unmount } = await mount(
      <ModelWaitCard {...propsOf([action({ id: 'p', label: 'Providers', onSelect })])} />,
    )
    await click(named(container, 'Providers'))
    expect(onSelect).toHaveBeenCalledTimes(1)
    await unmount()
  })

  it('holds a confirmed action until the dialog is confirmed', async () => {
    const onSelect = mock(() => undefined)
    const { container, unmount } = await mount(
      <ModelWaitCard
        {...propsOf([
          action({
            id: 'r',
            label: 'Recheck access',
            primary: true,
            onSelect,
            confirm: {
              title: 'Recheck access?',
              description: 'may incur normal model charges',
              confirmLabel: 'Recheck and continue',
            },
          }),
        ])}
      />,
    )
    await click(named(container, 'Recheck access'))
    expect(onSelect).not.toHaveBeenCalled()
    expect(container.textContent).toContain('may incur normal model charges')
    await click(named(container, 'Recheck and continue'))
    expect(onSelect).toHaveBeenCalledTimes(1)
    await unmount()
  })

  it('cancels a confirmation without running the action', async () => {
    const onSelect = mock(() => undefined)
    const { container, unmount } = await mount(
      <ModelWaitCard
        {...propsOf([
          action({
            id: 'r',
            label: 'Recheck access',
            onSelect,
            confirm: { title: 'Recheck?', description: 'charges', confirmLabel: 'Go' },
          }),
        ])}
      />,
    )
    await click(named(container, 'Recheck access'))
    await click(named(container, 'Cancel'))
    expect(onSelect).not.toHaveBeenCalled()
    expect(named(container, 'Recheck access')).toBeDefined()
    await unmount()
  })

  it('disables only a pending action and shows its inline pending text', async () => {
    const { container, unmount } = await mount(
      <ModelWaitCard
        {...propsOf([
          action({ id: 'r', label: 'Recheck access', pending: true, pendingLabel: 'Rechecking…' }),
          action({ id: 'p', label: 'Providers' }),
        ])}
      />,
    )
    expect((named(container, 'Rechecking…') as HTMLButtonElement).disabled).toBe(true)
    expect((named(container, 'Providers') as HTMLButtonElement).disabled).toBe(false)
    await unmount()
  })

  it('collapses detail with Escape, keeps the heading and actions, and returns focus', async () => {
    const { container, unmount } = await mount(
      <ModelWaitCard {...propsOf([action({ id: 'p', label: 'Providers' })])} />,
    )
    const toggle = named(container, 'Hide details') as HTMLButtonElement
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    await act(async () => {
      container
        .querySelector('section')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    const after = named(container, 'Show details') as HTMLButtonElement
    expect(after.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(after)
    expect(container.querySelector('h3')?.textContent).toBe('Waiting for model')
    expect(named(container, 'Providers')).toBeDefined()
    await unmount()
  })

  it('says no sessions are waiting for an empty list and surfaces an error note as an alert', async () => {
    const props = propsOf([])
    const [issue] = props.issues
    if (issue === undefined) throw new Error('fixture')
    const { container, unmount } = await mount(
      <ModelWaitCard
        {...props}
        issues={[
          {
            ...issue,
            affectedLabel: 'No sessions currently waiting',
            affected: [],
            note: { tone: EModelWaitNoteTone.Error, text: 'Could not reach the sandbox.' },
          },
        ]}
      />,
    )
    expect(container.textContent).toContain('No sessions currently waiting')
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Could not reach the sandbox.',
    )
    await unmount()
  })
})
