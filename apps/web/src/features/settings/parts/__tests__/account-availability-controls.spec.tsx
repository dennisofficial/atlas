import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'

import {
  controlFailureNoteOf,
  EAccountAccess,
  EControlOutcomeTone,
} from '@dltech/atlas-client/transcript'
import { toAccountId } from '@dltech/atlas-core'

import type { AccountAvailabilityView } from '../../data/personal/use-account-availability'

const { AccountAvailabilityControls } = await import('../account-availability-controls')

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})
const unmounts: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) await unmount()
})

const key = { accountId: toAccountId('acct-1'), providerId: 'anthropic', modelId: 'claude-x' }
const viewOf = (overrides: Partial<AccountAvailabilityView> = {}): AccountAvailabilityView => ({
  access: {
    access: EAccountAccess.Available,
    label: null,
    key: null,
    generation: null,
    affected: 0,
  },
  pending: false,
  note: null,
  onPause: null,
  onRemovePause: null,
  ...overrides,
})

async function mount(view: AccountAvailabilityView) {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () =>
    root.render(<AccountAvailabilityControls accountLabel="Work account" view={view} />),
  )
  unmounts.push(() => act(async () => root.unmount()))
  return container
}
const button = (container: Element, label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
const click = (element: Element | null) =>
  act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })

describe('AccountAvailabilityControls', () => {
  it('shows only Connected, with no action and no caveat, for a healthy idle account', async () => {
    const container = await mount(viewOf())
    expect(container.textContent).toBe('Connected')
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  it('shows Connected and a separate Exhausted badge with a Pause action', async () => {
    const container = await mount(
      viewOf({
        access: {
          access: EAccountAccess.Exhausted,
          label: 'Allowance exhausted',
          key,
          generation: 4,
          affected: 2,
        },
        onPause: () => undefined,
      }),
    )
    expect(container.textContent).toContain('Connected')
    expect(container.textContent).toContain('Allowance exhausted')
    expect(button(container, 'Pause Work account')).not.toBeNull()
    expect(button(container, 'Remove manual pause on Work account')).toBeNull()
  })

  it('does not pause until the confirmation is accepted', async () => {
    const onPause = mock(() => undefined)
    const container = await mount(
      viewOf({
        access: {
          access: EAccountAccess.Exhausted,
          label: 'Allowance exhausted',
          key,
          generation: 4,
          affected: 2,
        },
        onPause,
      }),
    )
    await click(button(container, 'Pause Work account'))
    expect(onPause).not.toHaveBeenCalled()
  })

  it('offers Remove manual pause for a paused account and runs it directly', async () => {
    const onRemovePause = mock(() => undefined)
    const container = await mount(
      viewOf({
        access: {
          access: EAccountAccess.Paused,
          label: 'Paused by you',
          key,
          generation: 4,
          affected: 1,
        },
        onRemovePause,
      }),
    )
    expect(container.textContent).toContain('Paused by you')
    expect(button(container, 'Pause Work account')).toBeNull()
    await click(button(container, 'Remove manual pause on Work account'))
    expect(onRemovePause).toHaveBeenCalledTimes(1)
  })

  it('disables the controls and shows inline pending text while updating', async () => {
    const container = await mount(
      viewOf({
        pending: true,
        access: {
          access: EAccountAccess.Paused,
          label: 'Paused by you',
          key,
          generation: 4,
          affected: 1,
        },
        onRemovePause: () => undefined,
      }),
    )
    expect(button(container, 'Remove manual pause on Work account')?.disabled).toBe(true)
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Updating…')
  })

  it('surfaces a transport error as an alert and keeps the prior state', async () => {
    const note = controlFailureNoteOf(new Error('socket closed'))
    expect(note.tone).toBe(EControlOutcomeTone.Error)
    const container = await mount(
      viewOf({
        note,
        access: {
          access: EAccountAccess.Paused,
          label: 'Paused by you',
          key,
          generation: 4,
          affected: 1,
        },
        onRemovePause: () => undefined,
      }),
    )
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('socket closed')
    expect(container.textContent).toContain('Paused by you')
  })
})
