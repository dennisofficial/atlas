import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'

import { KeyDialog } from '../agent-key-dialog'

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(async () => {
  const mounted = root
  if (mounted !== null) await act(async () => mounted.unmount())
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
})

async function render(node: ReactNode): Promise<HTMLDivElement> {
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const mounted = root
  await act(async () => mounted.render(node))
  return container
}

const click = async (element: Element | null | undefined): Promise<void> => {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

const typeInto = async (element: HTMLInputElement, value: string): Promise<void> => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const buttonNamed = (name: string): Element | undefined =>
  [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === name)

const dialogFor = (onSave: (key: string) => Promise<boolean>) => (
  <KeyDialog
    providerName="Anthropic"
    placeholder="sk-ant-…"
    triggerLabel="Add key"
    onSave={onSave}
  />
)

async function openAndSave(): Promise<void> {
  await click(buttonNamed('Add key'))
  const input = document.querySelector<HTMLInputElement>('#key-Anthropic')
  if (input === null) throw new Error('the key field did not render')
  await typeInto(input, 'sk-ant-abcdefghijklmnopqrst')
  await click(buttonNamed('Save'))
}

describe('KeyDialog', () => {
  it('keeps the dialog open with the error shown when the save fails', async () => {
    const onSave = mock(async () => false)
    await render(dialogFor(onSave))
    await openAndSave()

    expect(onSave).toHaveBeenCalledWith('sk-ant-abcdefghijklmnopqrst')
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('not accepted')
    expect(document.querySelector('#key-Anthropic')).not.toBeNull()
  })

  it('closes the dialog when the key is saved', async () => {
    const onSave = mock(async () => true)
    await render(dialogFor(onSave))
    await openAndSave()

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(document.querySelector('#key-Anthropic')).toBeNull()
  })
})
