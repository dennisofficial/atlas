import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'

import { API_KEY_PROVIDERS, EProviderId } from '../../fixtures/settings-agent'
import { ApiKeyRow } from '../agent-api-key-row'

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
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const mounted = root
  await act(async () => mounted.render(node))
  return container
}

const providerOf = (id: EProviderId) => {
  const found = API_KEY_PROVIDERS.find((provider) => provider.id === id)
  if (found === undefined) throw new Error(`no provider ${id}`)
  return found
}

const buttonLabels = (element: HTMLElement): string[] =>
  [...element.querySelectorAll('button')].map((button) => button.textContent ?? '')

describe('the Inference.net API key row', () => {
  it('is listed among the API-key providers', () => {
    expect(API_KEY_PROVIDERS.map((provider) => provider.id)).toContain(EProviderId.Inference)
  })

  it('offers to add a key when none is saved', async () => {
    const element = await render(
      <ApiKeyRow
        provider={providerOf(EProviderId.Inference)}
        entry={null}
        onSave={() => {}}
        onRemove={() => {}}
      />,
    )

    expect(element.textContent).toContain('Inference.net')
    expect(buttonLabels(element)).toContain('Add key')
  })

  it('offers replace and remove once a key is saved', async () => {
    const element = await render(
      <ApiKeyRow
        provider={providerOf(EProviderId.Inference)}
        entry={{ id: 'acc_1', label: 'Key saved', added: 'Added Oct 30' }}
        onSave={() => {}}
        onRemove={() => {}}
      />,
    )

    expect(buttonLabels(element)).toEqual(expect.arrayContaining(['Replace', 'Remove']))
  })
})
