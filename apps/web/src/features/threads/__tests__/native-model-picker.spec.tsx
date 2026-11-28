import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { act, type ReactElement } from 'react'

import { EEffort, type ModelOption } from '@dltech/atlas-ui/ai/model-selector'

registerDom()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { NativeModelPickerControls } = await import('../native-model-picker')
const { togglePinned } = await import('@dltech/atlas-ui/ai/model-selector')

afterAll(async () => {
  await unregisterDom()
})

const MODELS: ModelOption[] = [
  {
    id: 'anthropic/claude-opus-5',
    label: 'Opus 5',
    provider: 'Claude Plan',
    context: '1M',
    rate: '$20.00/M',
    monogram: 'A',
    fast: true,
    efforts: [EEffort.Low, EEffort.High],
    effortLabels: { [EEffort.High]: 'High' },
  },
  {
    id: 'openai/gpt-5.6',
    label: 'GPT 5.6',
    provider: 'OpenAI',
    monogram: 'O',
    efforts: [EEffort.Medium],
  },
  {
    id: 'gateway/deepseek',
    label: 'DeepSeek',
    provider: 'Gateway',
    monogram: 'D',
    disabled: true,
    disabledNote: 'not connected',
  },
]

const SELECTION = { id: 'anthropic/claude-opus-5', effort: EEffort.Max, fast: true }

const bridge = ({ answer = { ok: true } } = {}) => {
  const calls = { shown: [], hidden: 0, listeners: [] }
  const desktop = {
    nativeModelPicker: true,
    showModelPicker: (request: unknown) => {
      calls.shown.push(request)
      return Promise.resolve(answer)
    },
    hideModelPicker: () => {
      calls.hidden += 1
      return Promise.resolve()
    },
    onModelPickerEvent: (listener: (event: unknown) => void) => calls.listeners.push(listener),
    offModelPickerEvent: (listener: (event: unknown) => void) => {
      calls.listeners = calls.listeners.filter((entry) => entry !== listener)
    },
  }
  return { calls, desktop }
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

const trigger = () => document.querySelector('[aria-label="Choose a model"]')

afterEach(() => {
  Reflect.deleteProperty(window, 'atlasDesktop')
  document.body.innerHTML = ''
})

describe('NativeModelPickerControls', () => {
  const mountControls = async ({ answer, open, onOpenChange = () => undefined } = {}) => {
    const { calls, desktop } = bridge(answer === undefined ? {} : { answer })
    Reflect.set(window, 'atlasDesktop', desktop)
    const picks = []
    const pins = []
    const unavailable = []
    const unmount = await mount(
      <NativeModelPickerControls
        picker={{
          ready: true,
          options: { models: MODELS, reconnectProviders: [] },
          personalId: '',
          personalEffort: '',
          personalFast: false,
          pinned: ['anthropic/claude-opus-5'],
          onPinnedChange: (ids) => pins.push(ids),
        }}
        selection={SELECTION}
        onSelectionChange={(selection) => picks.push(selection)}
        {...(open === undefined ? {} : { open })}
        onOpenChange={onOpenChange}
        onNativeUnavailable={() => unavailable.push(true)}
      />,
    )
    return { calls, desktop, picks, pins, unavailable, unmount }
  }

  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('asks the app to open the panel at the trigger', async () => {
    const { calls, unmount } = await mountControls()
    const button = trigger()
    expect(button).not.toBeNull()
    await act(async () => {
      button.click()
      await Promise.resolve()
    })
    expect(calls.shown).toHaveLength(1)
    expect(calls.shown[0].selected).toEqual({
      id: 'anthropic/claude-opus-5',
      effort: EEffort.Max,
      fast: true,
    })
    expect(calls.shown[0].anchor).toMatchObject({ x: 0, y: 0 })
    await unmount()
  })

  it('applies a selection event through the shared normaliser', async () => {
    const changed = []
    const { calls, picks, unmount } = await mountControls({
      onOpenChange: (open) => changed.push(open),
    })
    expect(calls.listeners).toHaveLength(1)
    await act(async () => {
      calls.listeners[0]({
        kind: 'select',
        modelId: 'openai/gpt-5.6',
        effort: 'max',
        fast: true,
        dismiss: true,
      })
    })
    expect(picks).toEqual([{ id: 'openai/gpt-5.6', effort: EEffort.Medium, fast: false }])
    expect(changed).toEqual([false])
    await unmount()
  })

  it('persists a pin through the picker it was given', async () => {
    const { calls, pins, unmount } = await mountControls()
    await act(async () => {
      calls.listeners[0]({ kind: 'pin', modelId: 'anthropic/claude-opus-5' })
    })
    expect(pins).toEqual([
      togglePinned({ pinned: ['anthropic/claude-opus-5'], id: 'anthropic/claude-opus-5' }),
    ])
    await unmount()
  })

  it('falls back to the React picker when the panel does not open', async () => {
    const { unavailable, unmount } = await mountControls({
      answer: { ok: false, reason: 'no-addon' },
    })
    await act(async () => {
      trigger().click()
      await Promise.resolve()
    })
    expect(unavailable).toHaveLength(1)
    await unmount()
  })

  it('opens the panel when the slash command sets open', async () => {
    const { calls, unmount } = await mountControls({ open: true })
    await act(async () => {
      await Promise.resolve()
    })
    expect(calls.shown).toHaveLength(1)
    await unmount()
  })
})
