import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'

import { EKeyDialogMode, type KeyDialogResult, ProviderKeyDialog } from '../provider-key-dialog'

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
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
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

const field = (id: string): HTMLInputElement | null =>
  document.querySelector<HTMLInputElement>(`#${id}`)

function dialogFor(args: {
  onSave: (result: KeyDialogResult) => Promise<string | null>
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <ProviderKeyDialog
      providerName="Anthropic"
      keyPrefix="sk-ant-"
      mode={EKeyDialogMode.Add}
      open
      offerUse
      onOpenChange={args.onOpenChange ?? (() => {})}
      onSave={args.onSave}
    />
  )
}

async function fillAndSave(args: { name: string; key: string }): Promise<void> {
  const nameField = field('provider-key-name')
  const keyField = field('provider-key-value')
  if (nameField === null || keyField === null) throw new Error('the dialog fields did not render')
  await typeInto(nameField, args.name)
  await typeInto(keyField, args.key)
  await click(buttonNamed('Save'))
}

describe('ProviderKeyDialog', () => {
  it('saves the name, the key and the choice to use it now', async () => {
    const onSave = mock(async () => null)
    await render(dialogFor({ onSave }))

    await fillAndSave({ name: 'Work', key: 'sk-ant-abcdefghijklmnop' })

    expect(onSave).toHaveBeenCalledWith({
      name: 'Work',
      key: 'sk-ant-abcdefghijklmnop',
      use: false,
    })
  })

  it('names an unnamed key API key', async () => {
    const onSave = mock(async () => null)
    await render(dialogFor({ onSave }))

    await fillAndSave({ name: '', key: 'sk-ant-abcdefghijklmnop' })

    expect(onSave).toHaveBeenCalledWith({
      name: 'API key',
      key: 'sk-ant-abcdefghijklmnop',
      use: false,
    })
  })

  it('stays open with the server message when the key is refused', async () => {
    const onOpenChange = mock(() => {})
    const onSave = mock(async () => 'Anthropic refused this key (401).')
    await render(dialogFor({ onSave, onOpenChange }))

    await fillAndSave({ name: 'Work', key: 'sk-ant-abcdefghijklmnop' })

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Anthropic refused this key (401).',
    )
    expect(field('provider-key-value')).not.toBeNull()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('closes when the key is saved', async () => {
    const onOpenChange = mock(() => {})
    const onSave = mock(async () => null)
    await render(
      <ProviderKeyDialog
        providerName="Anthropic"
        keyPrefix="sk-ant-"
        mode={EKeyDialogMode.Add}
        open
        onOpenChange={onOpenChange}
        onSave={onSave}
      />,
    )

    await fillAndSave({ name: 'Work', key: 'sk-ant-abcdefghijklmnop' })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
