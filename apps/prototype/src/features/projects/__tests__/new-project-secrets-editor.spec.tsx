import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act, useState } from 'react'
import type { Root } from 'react-dom/client'

import { emptyDraft } from '../new-project-draft'
import type { ProjectDraft } from '../new-project-types'

let SecretsEditor: typeof import('../new-project-secrets-editor').SecretsEditor
let root: Root | null = null
let container: HTMLDivElement | null = null
let current: ProjectDraft = emptyDraft()

beforeAll(async () => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  SecretsEditor = (await import('../new-project-secrets-editor')).SecretsEditor
})

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount())
  root = null
  container?.remove()
  container = null
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

function Editor() {
  const [draft, setDraft] = useState(emptyDraft)
  current = draft
  return (
    <SecretsEditor
      draft={draft}
      patch={(changes) => setDraft((previous) => ({ ...previous, ...changes }))}
    />
  )
}

async function mount() {
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<Editor />))
}

async function click(label: string) {
  const button = [...(container?.querySelectorAll('button') ?? [])].find(
    (item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label,
  )
  if (!button) throw new Error(`Missing button: ${label}`)
  await act(async () => button.click())
}

async function paste(text: string) {
  const textarea = container?.querySelector('textarea')
  if (!textarea) throw new Error('Missing paste field')
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } })
  await act(async () => textarea.dispatchEvent(event))
}

describe('prototype SecretsEditor interactions', () => {
  it('adds and removes manual rows', async () => {
    await mount()
    await click('Add value')
    await click('Add value')
    expect(current.secrets).toEqual([
      { name: '', value: '' },
      { name: '', value: '' },
    ])
    await click('Remove value 1')
    expect(current.secrets).toEqual([{ name: '', value: '' }])
    expect(container?.textContent).toContain('Use letters, digits')
  })

  it('pastes multiple values, masks them immediately, and flags duplicates', async () => {
    await mount()
    await click('Paste .env')
    await paste('API_KEY=private\nTOKEN=secret')
    expect(current.secrets).toEqual([
      { name: 'API_KEY', value: 'private' },
      { name: 'TOKEN', value: 'secret' },
    ])
    expect(container?.querySelector('textarea')).toBeNull()
    expect(container?.querySelectorAll('input[type=password]').length).toBe(0)
    const value = container?.querySelector<HTMLInputElement>('#project-secret-value-0')
    expect(value?.type).toBe('text')
    expect(value?.value).toBe('private')
    expect(value?.getAttribute('class')).toContain('disc')
    await click('Reveal value 1')
    expect(value?.getAttribute('class')).toContain('none')
    expect(value?.value).toBe('private')
    expect(
      container?.querySelector('[aria-label="Hide value 1"]')?.getAttribute('aria-pressed'),
    ).toBe('true')
    await click('Hide value 1')
    expect(value?.getAttribute('class')).toContain('disc')
    expect(value?.value).toBe('private')
    expect(current.secrets[0]?.value).toBe('private')
    expect(container?.textContent).not.toContain('private')
    await click('Paste .env')
    await paste('TOKEN=another')
    expect(container?.textContent).toContain('Duplicate name: TOKEN')
    await click('Remove TOKEN 3')
    expect(container?.textContent).not.toContain('Duplicate name')
  })

  it('does not partially import malformed pasted text or display its values', async () => {
    await mount()
    await click('Paste .env')
    await paste('API_KEY=private\nmalformed')
    expect(current.secrets).toEqual([])
    expect(container?.textContent).toContain('Fix lines 2')
    expect(container?.textContent).not.toContain('private')
    expect(container?.querySelector('textarea')?.value).toBe('')
  })
})
