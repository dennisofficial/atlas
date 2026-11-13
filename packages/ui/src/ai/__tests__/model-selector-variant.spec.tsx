import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import type { ReactElement } from 'react'
import { act } from 'react'

GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { ModelSelector } = await import('../model-selector')
const { EModelSelectorVariant } = await import('../model-selector-variant')
const { EEffort } = await import('../model-selector-groups')

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

let root: { render: (node: ReactElement) => void; unmount: () => void } | null = null

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

const MODELS = [
  {
    id: 'gateway/deepseek/deepseek-v4.1-flash-1017',
    label: 'DeepSeek V4.1 Flash',
    provider: 'AI Gateway',
    efforts: [EEffort.Off, EEffort.Low, EEffort.High, EEffort.Max],
    fast: true,
  },
]

async function renderSelector(element: ReactElement) {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const created = createRoot(container)
  root = created
  await act(async () => created.render(element))
  return container
}

describe('ModelSelector variant', () => {
  it('hides the name column of every control in the composer', async () => {
    const container = await renderSelector(
      <ModelSelector
        models={MODELS}
        value={MODELS[0]?.id ?? ''}
        effort={EEffort.Low}
        fast
        onFastChange={() => undefined}
      />,
    )
    const chevron = container.querySelector('[data-slot=model-trigger] .max-md\\:hidden')
    expect(chevron).not.toBeNull()
    expect(container.querySelector('[data-slot=model-fast] .max-md\\:sr-only')).not.toBeNull()
  })

  it('keeps the brand mark, the chevron and the Fast word at every width as a field', async () => {
    const container = await renderSelector(
      <ModelSelector
        models={MODELS}
        value={MODELS[0]?.id ?? ''}
        effort={EEffort.Low}
        fast
        onFastChange={() => undefined}
        variant={EModelSelectorVariant.Field}
      />,
    )
    expect(container.querySelector('[data-slot=model-trigger] .max-md\\:hidden')).toBeNull()
    expect(container.querySelector('[data-slot=model-trigger] svg')).not.toBeNull()
    expect(container.querySelector('[data-slot=model-fast] .max-md\\:sr-only')).toBeNull()
    expect(container.querySelector('[data-slot=model-fast]')?.textContent ?? '').toContain('Fast')
  })
})
