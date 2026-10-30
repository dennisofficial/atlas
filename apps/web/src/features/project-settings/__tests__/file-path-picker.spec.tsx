import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { act, useState } from 'react'
import type { Root } from 'react-dom/client'

GlobalRegistrator.register()
globalThis.IS_REACT_ACT_ENVIRONMENT = true

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const { ERepoTreeEntryKind } = await import('@dltech/atlas-wire/web')
const { FilePathPicker } = await import('../file-path-picker')

const ENTRIES = [
  { path: 'apps', kind: ERepoTreeEntryKind.Folder },
  { path: 'apps/api', kind: ERepoTreeEntryKind.Folder },
  { path: 'apps/web', kind: ERepoTreeEntryKind.Folder },
  { path: 'README.md', kind: ERepoTreeEntryKind.File },
]

function Harness() {
  const [path, setPath] = useState('')
  return (
    <>
      <FilePathPicker
        id="path"
        entries={ENTRIES}
        path={path}
        invalid={false}
        onPathChange={setPath}
      />
      <output data-testid="path">{path}</output>
    </>
  )
}

let root: Root | undefined

afterEach(async () => {
  if (root !== undefined) await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})

async function renderPicker() {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<Harness />))
  const input = container.querySelector('input')
  if (input === null) throw new Error('no input')
  return input
}

const pathState = () => document.querySelector('[data-testid="path"]')?.textContent ?? ''

async function typeInto(input: HTMLInputElement, text: string) {
  for (const char of text) {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, input.value + char)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
}

async function press(input: HTMLInputElement, key: string) {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

const options = () => [...document.querySelectorAll('[role="option"]')]

describe('FilePathPicker', () => {
  it('keeps a typed path when the suggestions close', async () => {
    const input = await renderPicker()
    await act(async () => input.focus())
    await typeInto(input, 'apps/api/.env.personal')
    await press(input, 'Escape')
    await act(async () => input.blur())
    expect(pathState()).toBe('apps/api/.env.personal')
    expect(input.value).toBe('apps/api/.env.personal')
  })

  it('fills in a folder picked from the list and keeps it', async () => {
    const input = await renderPicker()
    await act(async () => input.focus())
    await typeInto(input, 'apps/a')
    const folder = options().find((option) => option.textContent === 'apps/api/')
    if (folder === undefined) {
      throw new Error(
        `apps/api/ not offered: value=${input.value} expanded=${input.getAttribute('aria-expanded')} focused=${document.activeElement === input} options=${JSON.stringify(options().map((option) => option.textContent))}`,
      )
    }
    await act(async () => (folder as HTMLElement).click())
    expect(pathState()).toBe('apps/api/')
    expect(input.value).toBe('apps/api/')
  })

  it('completes the highlighted suggestion on Tab instead of leaving the field', async () => {
    const input = await renderPicker()
    await act(async () => input.focus())
    await typeInto(input, 'apps/a')
    await press(input, 'Tab')
    expect(pathState()).toBe('apps/api/')
    expect(document.activeElement).toBe(input)
  })
})
