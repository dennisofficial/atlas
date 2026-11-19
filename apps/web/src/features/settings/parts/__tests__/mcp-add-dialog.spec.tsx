import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'

import type { McpDraft } from '../mcp-store'
import { McpAddDialog } from '../mcp-add-dialog'

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
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

async function openDialogWithFields(): Promise<void> {
  await click(buttonNamed('Add MCP Server'))
  const name = document.querySelector<HTMLInputElement>('#mcp-name')
  const target = document.querySelector<HTMLInputElement>('#mcp-target')
  if (name === null || target === null) throw new Error('dialog fields did not render')
  await typeInto(name, 'paper')
  await typeInto(target, 'paper mcp')
}

describe('McpAddDialog proxy switch', () => {
  it('sends proxy when the switch is on', async () => {
    const onAdd = mock((_draft: McpDraft) => {})
    await render(<McpAddDialog onAdd={onAdd} />)
    await openDialogWithFields()

    await click(document.querySelector('#mcp-proxy'))
    await click(buttonNamed('Add server'))

    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 'paper', proxy: true }))
  })

  it('sends proxy false when the switch is untouched', async () => {
    const onAdd = mock((_draft: McpDraft) => {})
    await render(<McpAddDialog onAdd={onAdd} />)
    await openDialogWithFields()

    await click(buttonNamed('Add server'))

    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 'paper', proxy: false }))
  })
})
