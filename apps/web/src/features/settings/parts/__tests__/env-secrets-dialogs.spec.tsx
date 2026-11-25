import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'

import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'

import { BulkAddDialog, type SecretPair } from '../env-secrets-dialogs'

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

async function render(node: ReactNode): Promise<void> {
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const mounted = root
  await act(async () => mounted.render(node))
}

const click = async (element: Element | null | undefined): Promise<void> => {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

const typeInto = async (element: HTMLTextAreaElement, value: string): Promise<void> => {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const buttonNamed = (name: string): Element | undefined =>
  [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === name)

async function pasteSecrets(lines: string): Promise<void> {
  await click(buttonNamed('Bulk add'))
  const textarea = document.querySelector<HTMLTextAreaElement>('#bulk-secrets')
  if (textarea === null) throw new Error('bulk field did not render')
  await typeInto(textarea, lines)
}

const PAIRS: SecretPair[] = [
  { name: 'API_KEY', value: 'one' },
  { name: 'TOKEN', value: 'two' },
]

describe('BulkAddDialog', () => {
  it('hands the grant id and the pasted pairs to its caller', async () => {
    const onAdd = mock((_args: { grantId: string; pairs: SecretPair[] }) => {})
    await render(<BulkAddDialog grantId="g1" onAdd={onAdd} />)
    await pasteSecrets('API_KEY=one\nTOKEN=two')

    await click(buttonNamed('Add 2 secrets'))

    expect(onAdd).toHaveBeenCalledWith({ grantId: 'g1', pairs: PAIRS })
  })
})
