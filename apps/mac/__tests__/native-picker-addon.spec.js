import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import {
  MODEL_PICKER_HIDE,
  MODEL_PICKER_SHOW,
  createNativeModelPicker,
  loadNativeAddon,
  nativeAddonPath,
  registerModelPickerIpc,
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

describe('nativeAddonPath', () => {
  test('reads the packaged addon from Resources', () => {
    expect(
      nativeAddonPath({
        resourcesPath: '/Applications/Atlas.app/Contents/Resources',
        appRoot: '/app',
        platform: 'darwin',
        arch: 'arm64',
      }),
    ).toBe('/Applications/Atlas.app/Contents/Resources/native/atlas_native.node')
  })

  test('reads the prebuild in development', () => {
    expect(nativeAddonPath({ appRoot: '/repo/apps/mac', platform: 'darwin', arch: 'arm64' })).toBe(
      join('/repo/apps/mac', 'native', 'prebuilds', 'darwin-arm64', 'atlas_native.node'),
    )
  })

  test('is null everywhere the addon does not ship', () => {
    expect(nativeAddonPath({ appRoot: '/app', platform: 'linux', arch: 'arm64' })).toBeNull()
    expect(nativeAddonPath({ appRoot: '/app', platform: 'darwin', arch: 'x64' })).toBeNull()
  })

  test('loads nothing when the module is missing or throws', () => {
    const missing = loadNativeAddon({
      appRoot: '/app',
      platform: 'darwin',
      arch: 'arm64',
      require: () => {
        throw new Error('dlopen failed')
      },
    })
    expect(missing).toBeNull()
    expect(
      loadNativeAddon({ appRoot: '/app', platform: 'linux', arch: 'arm64', require: () => ({}) }),
    ).toBeNull()
    const loaded = { show: () => 1 }
    expect(
      loadNativeAddon({
        appRoot: '/app',
        platform: 'darwin',
        arch: 'arm64',
        require: () => loaded,
      }),
    ).toBe(loaded)
  })
})

describe('registerModelPickerIpc', () => {
  const harness = () => {
    const handlers = new Map()
    const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) }
    const { addon, calls } = fakeAddon()
    const picker = createNativeModelPicker({ addon })
    const { win } = fakeWindow()
    registerModelPickerIpc({ ipcMain, picker, windowOf: () => win })
    return { handlers, calls, win }
  }

  test('shows through the window that sent the request', () => {
    const { handlers, calls } = harness()
    expect(handlers.has(MODEL_PICKER_SHOW)).toBe(true)
    const answer = handlers.get(MODEL_PICKER_SHOW)({ sender: {} }, request())
    expect(answer.ok).toBe(true)
    expect(calls.shown).toHaveLength(1)
  })

  test('hides the panel of that window', () => {
    const { handlers, calls } = harness()
    handlers.get(MODEL_PICKER_HIDE)({ sender: {} })
    expect(calls.hidden).toEqual([0])
  })

  test('answers no-window when no window owns the sender', () => {
    const handlers = new Map()
    const { addon } = fakeAddon()
    const picker = createNativeModelPicker({ addon })
    registerModelPickerIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      picker,
      windowOf: () => null,
    })
    expect(handlers.get(MODEL_PICKER_SHOW)({ sender: {} }, request())).toEqual({
      ok: false,
      reason: 'no-window',
    })
  })
})
