import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act, type ReactElement } from 'react'

import { RenameAction, RenameForm } from '../rename-action'

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

const mount = async (element: ReactElement) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(element))
  return () => act(async () => root.unmount())
}

const input = () =>
  document.body.querySelector<HTMLInputElement>('input[aria-label="Session name"]')

const press = async (key: string) =>
  act(async () => {
    input()?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })

const type = async (value: string) =>
  act(async () => {
    const field = input()
    if (!field) throw new Error('no input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })

describe('RenameForm', () => {
  it('opens prefilled with the current title and saves on Enter', async () => {
    const saved: string[] = []
    await mount(
      <RenameForm
        title="Fix login"
        onSave={async (name) => void saved.push(name)}
        onClose={() => undefined}
      />,
    )
    expect(input()?.value).toBe('Fix login')
    await type('Better name')
    await press('Enter')
    expect(saved).toEqual(['Better name'])
  })

  it('closes on Escape without saving', async () => {
    const saved: string[] = []
    let closed = 0
    await mount(
      <RenameForm
        title="a"
        onSave={async (name) => void saved.push(name)}
        onClose={() => closed++}
      />,
    )
    await press('Escape')
    expect(closed).toBe(1)
    expect(saved).toEqual([])
  })

  it('does not save an empty name', async () => {
    const saved: string[] = []
    await mount(
      <RenameForm
        title="a"
        onSave={async (name) => void saved.push(name)}
        onClose={() => undefined}
      />,
    )
    await type('   ')
    await press('Enter')
    expect(saved).toEqual([])
  })
})

describe('RenameAction', () => {
  it('shows a Rename pencil that opens the input with the current title', async () => {
    await mount(<RenameAction sessionId="s1" title="Fix login" />)
    const pencil = document.body.querySelector<HTMLButtonElement>('button[aria-label="Rename"]')
    expect(pencil).not.toBeNull()
    expect(input()).toBeNull()
    await act(async () => pencil?.click())
    expect(input()?.value).toBe('Fix login')
  })
})
