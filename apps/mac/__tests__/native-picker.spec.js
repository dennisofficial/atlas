import { describe, expect, test } from 'bun:test'

import {
  MODEL_LIMIT,
  MODEL_PICKER_EVENT,
  createNativeModelPicker,
  validModelPickerRequest,
} from '../native-picker.js'

const model = (id = 'anthropic/claude-opus-5') => ({
  id,
  label: 'Opus 5',
  provider: 'Claude Plan',
  context: '1M',
  rate: '$20.00/M',
  monogram: 'A',
  fast: true,
  efforts: ['low', 'high'],
  effortLabels: { high: 'High' },
})

const request = () => ({
  anchor: { x: 12, y: 40, width: 90, height: 24 },
  models: [model(), { id: 'openai/gpt-5.6', label: 'GPT 5.6' }],
  selected: { id: 'anthropic/claude-opus-5', effort: 'high', fast: false },
  pinned: ['anthropic/claude-opus-5'],
})

const fakeWindow = ({ destroyed = false } = {}) => {
  const sent = []
  const win = {
    getNativeWindowHandle: () => Buffer.alloc(8),
    webContents: { send: (channel, payload) => sent.push([channel, payload]) },
    isDestroyed: () => destroyed,
  }
  return { sent, win }
}

const fakeAddon = ({ shown = () => 7 } = {}) => {
  const calls = { handles: [], listeners: [], shown: [], hidden: [], shutdowns: 0 }
  const addon = {
    setWindowHandle: (handle) => calls.handles.push(handle),
    setEventCallback: (listener) => calls.listeners.push(listener),
    show: (payload) => {
      calls.shown.push(payload)
      return shown()
    },
    hide: (generation) => calls.hidden.push(generation),
    shutdown: () => {
      calls.shutdowns += 1
    },
  }
  return { addon, calls }
}

describe('validModelPickerRequest', () => {
  test('accepts the request the composer sends', () => {
    expect(validModelPickerRequest(request())).toBe(true)
  })

  test('rejects an empty list, a broken anchor, a long id and too many models', () => {
    expect(validModelPickerRequest({ ...request(), models: [] })).toBe(false)
    expect(validModelPickerRequest({ ...request(), anchor: { x: 0, y: Number.NaN } })).toBe(false)
    expect(
      validModelPickerRequest({ ...request(), anchor: { x: 0, y: 0, width: 0, height: 4 } }),
    ).toBe(false)
    expect(
      validModelPickerRequest({
        ...request(),
        models: [model('m'.repeat(500))],
      }),
    ).toBe(false)
    expect(
      validModelPickerRequest({
        ...request(),
        models: Array.from({ length: MODEL_LIMIT + 1 }, (_, at) => model(`model-${at}`)),
      }),
    ).toBe(false)
  })

  test('rejects an unknown effort, a missing selection and too many pins', () => {
    expect(
      validModelPickerRequest({
        ...request(),
        selected: { id: 'anthropic/claude-opus-5', effort: 'turbo', fast: false },
      }),
    ).toBe(false)
    expect(validModelPickerRequest({ ...request(), selected: undefined })).toBe(false)
    expect(
      validModelPickerRequest({
        ...request(),
        pinned: Array.from({ length: 51 }, (_, n) => `m-${n}`),
      }),
    ).toBe(false)
  })

  test('rejects a model with a non-string effort label', () => {
    const broken = { ...model(), effortLabels: { high: 3 } }
    expect(validModelPickerRequest({ ...request(), models: [broken] })).toBe(false)
  })
})

describe('createNativeModelPicker', () => {
  test('sends the addon a request with every unknown field dropped', () => {
    const { addon, calls } = fakeAddon()
    const picker = createNativeModelPicker({ addon })
    const { win } = fakeWindow()
    const answer = picker.show({
      win,
      request: {
        ...request(),
        future: 'shipped-later',
        models: [{ ...model(), ratePerImage: 3 }],
        selected: { ...request().selected, temperature: 1 },
      },
    })
    expect(answer).toEqual({ ok: true, generation: 7 })
    expect(calls.shown).toHaveLength(1)
    expect(calls.shown[0].future).toBeUndefined()
    expect(calls.shown[0].models[0].ratePerImage).toBeUndefined()
    expect(calls.shown[0].selected.temperature).toBeUndefined()
    expect(calls.shown[0].models[0].rate).toBe('$20.00/M')
  })

  test('never reaches the addon with a request it cannot trust', () => {
    const { addon, calls } = fakeAddon()
    const picker = createNativeModelPicker({ addon })
    const { win } = fakeWindow()
    expect(picker.show({ win, request: { ...request(), models: [] } })).toEqual({
      ok: false,
      reason: 'invalid-request',
    })
    expect(calls.shown).toEqual([])
  })

  test('answers no-addon so the web falls back to the React picker', () => {
    const picker = createNativeModelPicker({ addon: null })
    const { win } = fakeWindow()
    expect(picker.available).toBe(false)
    expect(picker.show({ win, request: request() })).toEqual({ ok: false, reason: 'no-addon' })
  })

  test('reports a panel that the addon could not make', () => {
    const { addon } = fakeAddon({ shown: () => 0 })
    const picker = createNativeModelPicker({ addon })
    const { win } = fakeWindow()
    expect(picker.show({ win, request: request() })).toEqual({ ok: false, reason: 'not-shown' })
  })

  test('forwards one addon event to the window once', () => {
    const { addon, calls } = fakeAddon()
    const picker = createNativeModelPicker({ addon })
    const { win, sent } = fakeWindow()
    picker.attach({ win })
    expect(calls.handles).toEqual([win.getNativeWindowHandle()])
    calls.listeners[0]({ kind: 'select', generation: 7, modelId: 'openai/gpt-5.6' })
    expect(sent).toEqual([
      [MODEL_PICKER_EVENT, { kind: 'select', generation: 7, modelId: 'openai/gpt-5.6' }],
    ])
  })

  test('drops events for a window that is gone', () => {
    const { addon, calls } = fakeAddon()
    const picker = createNativeModelPicker({ addon })
    const { win, sent } = fakeWindow({ destroyed: true })
    picker.attach({ win })
    calls.listeners[0]({ kind: 'dismiss', generation: 7 })
    expect(sent).toEqual([])
  })

  test('attaches to whoever shows the picker', () => {
    const { addon, calls } = fakeAddon()
    const picker = createNativeModelPicker({ addon })
    const { win } = fakeWindow()
    picker.show({ win, request: request() })
    expect(calls.handles).toHaveLength(1)
    expect(calls.listeners).toHaveLength(1)
  })

  test('detaches a closed window', () => {
    const { addon, calls } = fakeAddon()
    const picker = createNativeModelPicker({ addon })
    const { win } = fakeWindow()
    picker.attach({ win })
    picker.detach({ win })
    expect(calls.handles).toEqual([win.getNativeWindowHandle(), null])
    expect(calls.hidden).toEqual([0])
  })

  test('shuts down once even when disposed twice, and swallows a throwing addon', () => {
    const { addon, calls } = fakeAddon()
    const picker = createNativeModelPicker({ addon })
    picker.dispose()
    picker.dispose()
    expect(calls.shutdowns).toBe(1)
    expect(picker.show({ win: fakeWindow().win, request: request() })).toEqual({
      ok: false,
      reason: 'disposed',
    })

    const throwing = {
      setWindowHandle: () => undefined,
      setEventCallback: () => undefined,
      show: () => 1,
      hide: () => undefined,
      shutdown: () => {
        throw new Error('no')
      },
    }
    const logged = []
    const quiet = createNativeModelPicker({ addon: throwing, log: (line) => logged.push(line) })
    expect(() => quiet.dispose()).not.toThrow()
    expect(logged).toHaveLength(1)
  })
})
