import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test'
import type { ReactElement } from 'react'
import { act } from 'react'

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined }),
  usePathname: () => '/settings/models',
  useSearchParams: () => new URLSearchParams(),
}))

GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { ModelsEditor } = await import('../models-effort')
const { settingsValuesOf, modelPickerOf, saveNothing, GPT_5 } = await import(
  '../../fixtures/settings-models-story'
)
const { EProviderId } = await import('../../fixtures/settings-agent')

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

let root: { render: (node: ReactElement) => void; unmount: () => void } | null = null

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

async function mount(element: ReactElement) {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(element))
}

const ANTHROPIC_ONLY = [{ provider: EProviderId.Anthropic, status: 'connected' }]

const editorOn = (
  accounts: { provider: string; status: string }[],
  stored: Record<string, string>,
) =>
  mount(
    <ModelsEditor
      values={settingsValuesOf(stored)}
      save={saveNothing}
      picker={modelPickerOf({ accounts, stored })}
    />,
  )

const bodyText = () => document.body.textContent ?? ''

const triggerWarnings = () => [
  ...document.body.querySelectorAll<HTMLElement>('[data-slot="model-trigger"] .text-warning'),
]

describe('ModelsEditor', () => {
  it('renders the grouped skeleton until the picker is ready', async () => {
    await mount(
      <ModelsEditor
        values={settingsValuesOf()}
        save={saveNothing}
        picker={modelPickerOf({ accounts: ANTHROPIC_ONLY, ready: false })}
      />,
    )
    expect(bodyText()).toContain('Model')
    expect(bodyText()).toContain('Built-in sub-agents')
    expect(document.querySelector('[data-slot="model-trigger"]')).toBeNull()
  })

  it('shows the empty state when no model can be offered', async () => {
    await editorOn([], {})
    expect(bodyText()).toContain('Connect a provider to choose a model')
    expect(document.querySelector('[data-slot="model-trigger"]')).toBeNull()
  })

  it('names the stale model and its provider in the alert, and warns on the owning row only', async () => {
    await editorOn(ANTHROPIC_ONLY, { 'model.id': GPT_5 })
    const text = bodyText()
    expect(text).toContain("can't run: Codex Plan isn't connected")
    expect(text).toContain('GPT-5')
    expect(document.querySelectorAll('[data-slot="model-trigger"]').length).toBeGreaterThan(1)
    expect(triggerWarnings()).toHaveLength(1)
    const triggers = [...document.body.querySelectorAll('[data-slot="model-trigger"]')]
    expect(triggers[0]?.contains(triggerWarnings()[0] ?? null)).toBe(true)
  })
})
