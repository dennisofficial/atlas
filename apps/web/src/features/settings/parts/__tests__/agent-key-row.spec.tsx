import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'

import { EDecisionsProvider, ESearchBackend } from '../../fixtures/settings-decisions'
import { DecisionsKeyRow, SearchKeyRow } from '../agent-key-row'

type Saved = { name: string; value: string; noun: string }

const SECRET = 'sk-very-secret-value'

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
})

async function render(node: ReactNode): Promise<HTMLDivElement> {
  const { createRoot } = await import('react-dom/client')
  if (container === null) {
    container = document.createElement('div')
    document.body.append(container)
  }
  if (root === null) root = createRoot(container)
  const mounted = root
  await act(async () => mounted.render(node))
  return container
}

function inputIn(element: HTMLElement): HTMLInputElement {
  const input = element.querySelector('input')
  if (input === null) throw new Error('no key input rendered')
  return input
}

async function typeKey(args: { element: HTMLElement; value: string }): Promise<void> {
  const input = inputIn(args.element)
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setValue?.call(input, args.value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function clickSave(element: HTMLElement): Promise<void> {
  const button = [...element.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.startsWith('Save'),
  )
  if (button === undefined) throw new Error('no save button rendered')
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

const recorder = () => {
  const saved: Saved[] = []
  const onSave = async (entry: Saved) => {
    saved.push(entry)
    return true
  }
  return { saved, onSave }
}

describe('DecisionsKeyRow', () => {
  it('writes the key under the selected provider', async () => {
    const { saved, onSave } = recorder()
    const element = await render(
      <DecisionsKeyRow
        provider={EDecisionsProvider.Vercel}
        savedNames={new Set()}
        onSave={onSave}
      />,
    )
    await typeKey({ element, value: SECRET })
    await clickSave(element)
    expect(saved).toEqual([{ name: 'decisions.token.vercel', value: SECRET, noun: 'key' }])
  })

  it('reads and writes the new provider’s key after switching', async () => {
    const { saved, onSave } = recorder()
    const savedNames = new Set(['decisions.token.typesafe'])
    const typesafe = await render(
      <DecisionsKeyRow
        provider={EDecisionsProvider.Typesafe}
        savedNames={savedNames}
        onSave={onSave}
      />,
    )
    expect(typesafe.textContent).toContain('Key saved')

    const openai = await render(
      <DecisionsKeyRow
        provider={EDecisionsProvider.OpenAi}
        savedNames={savedNames}
        onSave={onSave}
      />,
    )
    expect(openai.textContent).toContain('No key saved')
    await typeKey({ element: openai, value: SECRET })
    await clickSave(openai)
    expect(saved).toEqual([{ name: 'decisions.token.openai', value: SECRET, noun: 'key' }])
  })

  it('never renders the key back after saving', async () => {
    const { onSave } = recorder()
    const element = await render(
      <DecisionsKeyRow
        provider={EDecisionsProvider.Typesafe}
        savedNames={new Set()}
        onSave={onSave}
      />,
    )
    await typeKey({ element, value: SECRET })
    expect(inputIn(element).type).toBe('password')
    await clickSave(element)
    expect(inputIn(element).value).toBe('')
    expect(element.innerHTML).not.toContain(SECRET)
  })
})

describe('trimming', () => {
  it('saves a pasted key without surrounding whitespace', async () => {
    const { saved, onSave } = recorder()
    const element = await render(
      <DecisionsKeyRow
        provider={EDecisionsProvider.Typesafe}
        savedNames={new Set()}
        onSave={onSave}
      />,
    )
    await typeKey({ element, value: `  ${SECRET}\n` })
    await clickSave(element)
    expect(saved).toEqual([{ name: 'decisions.token.typesafe', value: SECRET, noun: 'key' }])
  })
})

describe('SearchKeyRow', () => {
  it('saves a SearXNG instance as a URL', async () => {
    const { saved, onSave } = recorder()
    const element = await render(
      <SearchKeyRow backend={ESearchBackend.SearXNG} savedNames={new Set()} onSave={onSave} />,
    )
    expect(element.textContent).toContain('No URL saved')
    await typeKey({ element, value: 'https://searx.internal' })
    await clickSave(element)
    expect(saved).toEqual([
      { name: 'search.searxng', value: 'https://searx.internal', noun: 'URL' },
    ])
  })

  it('renders nothing for a backend that takes no key', async () => {
    const { onSave } = recorder()
    const element = await render(
      <SearchKeyRow backend={ESearchBackend.DuckDuckGo} savedNames={new Set()} onSave={onSave} />,
    )
    expect(element.querySelector('input')).toBeNull()
  })

  it('writes the key under the selected backend', async () => {
    const { saved, onSave } = recorder()
    const element = await render(
      <SearchKeyRow
        backend={ESearchBackend.Tavily}
        savedNames={new Set(['search.exa'])}
        onSave={onSave}
      />,
    )
    expect(element.textContent).toContain('No key saved')
    await typeKey({ element, value: SECRET })
    await clickSave(element)
    expect(saved).toEqual([{ name: 'search.tavily', value: SECRET, noun: 'key' }])
  })
})
