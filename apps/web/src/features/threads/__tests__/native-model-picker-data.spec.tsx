import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, describe, expect, it } from 'bun:test'

import { EEffort, type ModelOption } from '@dltech/atlas-ui/ai/model-selector'

registerDom()

const {
  MODEL_LIMIT,
  nativePickerAvailable,
  nativePickerPayload,
  outcomeOf,
  showNativePicker,
  watchNativePicker,
} = await import('../data/native-model-picker')
const { selectionAfterPick } = await import('../data/model-selection')

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

describe('nativePickerAvailable', () => {
  it('is off in a browser and on for a Mac app that advertises the panel', () => {
    expect(nativePickerAvailable({})).toBe(false)
    const { desktop } = bridge()
    expect(nativePickerAvailable({ atlasDesktop: desktop })).toBe(true)
  })

  it('is off when the capability is advertised without the methods behind it', () => {
    expect(nativePickerAvailable({ atlasDesktop: { nativeModelPicker: true } })).toBe(false)
  })
})

describe('nativePickerPayload', () => {
  it('shapes the composer models for the panel', () => {
    const payload = nativePickerPayload({
      models: MODELS,
      selection: SELECTION,
      pinned: ['openai'],
    })
    expect(payload.selected).toEqual({
      id: 'anthropic/claude-opus-5',
      effort: EEffort.Max,
      fast: true,
    })
    expect(payload.pinned).toEqual(['openai'])
    expect(payload.models[0]).toEqual({
      id: 'anthropic/claude-opus-5',
      label: 'Opus 5',
      provider: 'Claude Plan',
      context: '1M',
      rate: '$20.00/M',
      monogram: 'A',
      fast: true,
      efforts: [EEffort.Low, EEffort.High],
      effortLabels: { [EEffort.High]: 'High' },
    })
    expect(payload.models[2]?.disabled).toBe(true)
    expect(payload.models[2]?.disabledNote).toBe('not connected')
  })

  it('caps a list longer than the panel accepts', () => {
    const many = Array.from({ length: MODEL_LIMIT + 5 }, (_, at) => ({
      id: `model-${at}`,
      label: `Model ${at}`,
    }))
    expect(
      nativePickerPayload({ models: many, selection: SELECTION, pinned: [] }).models,
    ).toHaveLength(MODEL_LIMIT)
  })
})

describe('showNativePicker', () => {
  it('hands the main process the request with the trigger rect', async () => {
    const { calls, desktop } = bridge()
    const host = { atlasDesktop: desktop }
    const shown = await showNativePicker({
      host,
      anchor: { x: 10, y: 20, width: 90, height: 24 },
      payload: nativePickerPayload({ models: MODELS, selection: SELECTION, pinned: [] }),
    })
    expect(shown).toBe(true)
    expect(calls.shown).toHaveLength(1)
    expect(calls.shown[0].anchor).toEqual({ x: 10, y: 20, width: 90, height: 24 })
    expect(calls.shown[0].models).toHaveLength(3)
  })

  it('falls back when the app answers that the panel did not open', async () => {
    const { desktop } = bridge({ answer: { ok: false, reason: 'not-shown' } })
    expect(
      await showNativePicker({
        host: { atlasDesktop: desktop },
        anchor: { x: 0, y: 0, width: 1, height: 1 },
        payload: nativePickerPayload({ models: MODELS, selection: SELECTION, pinned: [] }),
      }),
    ).toBe(false)
  })

  it('falls back when the bridge throws', async () => {
    const desktop = {
      nativeModelPicker: true,
      showModelPicker: () => Promise.reject(new Error('ipc gone')),
      hideModelPicker: () => Promise.resolve(),
      onModelPickerEvent: () => undefined,
      offModelPickerEvent: () => undefined,
    }
    expect(
      await showNativePicker({
        host: { atlasDesktop: desktop },
        anchor: { x: 0, y: 0, width: 1, height: 1 },
        payload: nativePickerPayload({ models: MODELS, selection: SELECTION, pinned: [] }),
      }),
    ).toBe(false)
  })
})

describe('watchNativePicker', () => {
  it('delivers only well formed events and unsubscribes with the same listener', () => {
    const { calls, desktop } = bridge()
    const seen = []
    const unsubscribe = watchNativePicker({
      host: { atlasDesktop: desktop },
      onPick: (event) => seen.push(event),
    })
    expect(calls.listeners).toHaveLength(1)
    calls.listeners[0]({ kind: 'dismiss', generation: 3 })
    calls.listeners[0]({ nothing: true })
    calls.listeners[0](null)
    expect(seen).toEqual([{ kind: 'dismiss', generation: 3 }])
    unsubscribe()
    expect(calls.listeners).toHaveLength(0)
  })
})

describe('outcomeOf', () => {
  it('normalises a pick exactly as the React picker does', () => {
    const outcome = outcomeOf({
      models: MODELS,
      selection: SELECTION,
      event: {
        kind: 'select',
        modelId: 'openai/gpt-5.6',
        effort: 'max',
        fast: true,
        dismiss: true,
      },
    })
    expect(outcome).toEqual({
      kind: 'select',
      dismiss: true,
      selection: selectionAfterPick({
        models: MODELS,
        id: 'openai/gpt-5.6',
        effort: EEffort.Max,
        fast: true,
      }),
    })
    expect(outcome).toMatchObject({
      selection: { id: 'openai/gpt-5.6', effort: EEffort.Medium, fast: false },
    })
  })

  it('keeps the panel open when only the effort or the fast flag changes', () => {
    const outcome = outcomeOf({
      models: MODELS,
      selection: SELECTION,
      event: { kind: 'select', modelId: SELECTION.id, effort: 'high', fast: false, dismiss: false },
    })
    expect(outcome).toMatchObject({
      kind: 'select',
      dismiss: false,
      selection: { id: SELECTION.id, effort: EEffort.High, fast: false },
    })
  })

  it('reports a pin, a dismissal and an error', () => {
    expect(
      outcomeOf({
        models: MODELS,
        selection: SELECTION,
        event: { kind: 'pin', modelId: 'openai' },
      }),
    ).toEqual({ kind: 'pin', id: 'openai' })
    expect(outcomeOf({ models: MODELS, selection: SELECTION, event: { kind: 'dismiss' } })).toEqual(
      { kind: 'dismiss' },
    )
    expect(
      outcomeOf({
        models: MODELS,
        selection: SELECTION,
        event: { kind: 'error', message: 'the window is gone' },
      }),
    ).toEqual({ kind: 'error', message: 'the window is gone' })
  })
})
