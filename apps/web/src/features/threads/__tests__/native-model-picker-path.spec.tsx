import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test'
import * as realNavigation from 'next/navigation'
import { act, type ReactElement } from 'react'

import { EEffort, type ModelOption } from '@dltech/atlas-ui/ai/model-selector'

mock.module('next/navigation', () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => undefined }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

registerDom()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { ModelPickerControls } = await import('../model-picker')

afterAll(async () => {
  mock.module('next/navigation', () => realNavigation)
  await unregisterDom()
})

const MODELS: ModelOption[] = [
  {
    id: 'anthropic/claude-opus-5',
    label: 'Opus 5',
    provider: 'Claude Plan',
    monogram: 'A',
    fast: true,
    efforts: [EEffort.Low, EEffort.High],
  },
  { id: 'openai/gpt-5.6', label: 'GPT 5.6', provider: 'OpenAI', monogram: 'O' },
]

const desktop = (advertised = true) => {
  const calls = { shown: [] }
  return {
    calls,
    bridge: {
      ...(advertised ? { nativeModelPicker: true } : {}),
      showModelPicker: (request: unknown) => {
        calls.shown.push(request)
        return Promise.resolve({ ok: true })
      },
      hideModelPicker: () => Promise.resolve(),
      onModelPickerEvent: () => undefined,
      offModelPickerEvent: () => undefined,
    },
  }
}

const mount = async (element: ReactElement) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(element))
  await act(async () => undefined)
  return () => act(async () => root.unmount())
}

const controls = ({ native }: { native: boolean }) => (
  <ModelPickerControls
    picker={{
      ready: true,
      options: { models: MODELS, reconnectProviders: [] },
      personalId: '',
      personalEffort: '',
      personalFast: false,
      pinned: [],
      onPinnedChange: () => undefined,
    }}
    selection={{ id: 'anthropic/claude-opus-5', effort: EEffort.High, fast: true }}
    onSelectionChange={() => undefined}
    {...(native ? { native } : {})}
  />
)

const nativeTrigger = () => document.querySelector('[aria-label="Choose a model"]')
const anyTrigger = () => document.querySelector('[data-slot="model-trigger"]')

afterEach(() => {
  Reflect.deleteProperty(window, 'atlasDesktop')
  document.body.innerHTML = ''
})

describe('ModelPickerControls', () => {
  it('renders the native trigger when the Mac app advertises the panel', async () => {
    const { calls, bridge } = desktop()
    Reflect.set(window, 'atlasDesktop', bridge)
    const unmount = await mount(controls({ native: true }))
    expect(nativeTrigger()).not.toBeNull()
    expect(anyTrigger()?.textContent).toContain('Opus 5')
    await act(async () => {
      nativeTrigger()?.click()
      await Promise.resolve()
    })
    expect(calls.shown).toHaveLength(1)
    await unmount()
  })

  it('keeps the React popover in a browser tab, where no bridge exists', async () => {
    const unmount = await mount(controls({ native: true }))
    expect(nativeTrigger()).toBeNull()
    expect(anyTrigger()).not.toBeNull()
    await unmount()
  })

  it('keeps the React popover on a Mac app that predates the capability flag', async () => {
    const { calls, bridge } = desktop(false)
    Reflect.set(window, 'atlasDesktop', bridge)
    const unmount = await mount(controls({ native: true }))
    expect(nativeTrigger()).toBeNull()
    await act(async () => {
      anyTrigger()?.click()
      await Promise.resolve()
    })
    expect(calls.shown).toEqual([])
    await unmount()
  })

  it('ignores the native panel on a surface that did not ask for it', async () => {
    const { calls, bridge } = desktop()
    Reflect.set(window, 'atlasDesktop', bridge)
    const unmount = await mount(controls({ native: false }))
    expect(nativeTrigger()).toBeNull()
    await act(async () => {
      anyTrigger()?.click()
      await Promise.resolve()
    })
    expect(calls.shown).toEqual([])
    await unmount()
  })
})
