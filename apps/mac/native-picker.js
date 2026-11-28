import { join } from 'node:path'

export const ENativePickerEvent = {
  Select: 'select',
  Pin: 'pin',
  Dismiss: 'dismiss',
  Error: 'error',
}

export const MODEL_PICKER_SHOW = 'atlas-desktop:model-picker-show'
export const MODEL_PICKER_HIDE = 'atlas-desktop:model-picker-hide'
export const MODEL_PICKER_EVENT = 'atlas-desktop:model-picker-event'

export const MODEL_LIMIT = 200

const PIN_LIMIT = 50
const TEXT_LIMIT = 200
const EFFORT_NAMES = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)
const isText = (value) =>
  typeof value === 'string' && value.length > 0 && value.length <= TEXT_LIMIT
const isOptionalText = (value) => value === undefined || typeof value === 'string'
const isOptionalFlag = (value) => value === undefined || typeof value === 'boolean'

function validAnchor(anchor) {
  return (
    isObject(anchor) &&
    isFiniteNumber(anchor.x) &&
    isFiniteNumber(anchor.y) &&
    isFiniteNumber(anchor.width) &&
    isFiniteNumber(anchor.height) &&
    anchor.width > 0 &&
    anchor.height > 0
  )
}

function validEfforts(efforts) {
  if (efforts === undefined) return true
  return Array.isArray(efforts) && efforts.every((name) => EFFORT_NAMES.includes(name))
}

function validEffortLabels(labels) {
  if (labels === undefined) return true
  return isObject(labels) && Object.values(labels).every((value) => typeof value === 'string')
}

function validModel(model) {
  if (!isObject(model)) return false
  if (!isText(model.id) || !isText(model.label)) return false
  if (!isOptionalText(model.provider) || !isOptionalText(model.context)) return false
  if (!isOptionalText(model.rate) || !isOptionalText(model.monogram)) return false
  if (!isOptionalText(model.disabledNote)) return false
  if (!isOptionalFlag(model.disabled) || !isOptionalFlag(model.fast)) return false
  return validEfforts(model.efforts) && validEffortLabels(model.effortLabels)
}

function validSelection(selected) {
  if (!isObject(selected)) return false
  if (!isText(selected.id)) return false
  if (!EFFORT_NAMES.includes(selected.effort)) return false
  return typeof selected.fast === 'boolean'
}

function validPinned(pinned) {
  if (pinned === undefined) return true
  if (!Array.isArray(pinned) || pinned.length > PIN_LIMIT) return false
  return pinned.every((id) => isText(id))
}

export function validModelPickerRequest(request) {
  if (!isObject(request)) return false
  if (!validAnchor(request.anchor)) return false
  if (!Array.isArray(request.models)) return false
  if (request.models.length === 0 || request.models.length > MODEL_LIMIT) return false
  if (!request.models.every(validModel)) return false
  if (!validSelection(request.selected)) return false
  return validPinned(request.pinned)
}

export function pickerRequestOf(request) {
  return {
    anchor: {
      x: request.anchor.x,
      y: request.anchor.y,
      width: request.anchor.width,
      height: request.anchor.height,
    },
    models: request.models.map((model) => ({
      id: model.id,
      label: model.label,
      ...(typeof model.provider === 'string' ? { provider: model.provider } : {}),
      ...(typeof model.context === 'string' ? { context: model.context } : {}),
      ...(typeof model.rate === 'string' ? { rate: model.rate } : {}),
      ...(typeof model.monogram === 'string' ? { monogram: model.monogram } : {}),
      ...(typeof model.disabled === 'boolean' ? { disabled: model.disabled } : {}),
      ...(typeof model.disabledNote === 'string' ? { disabledNote: model.disabledNote } : {}),
      ...(typeof model.fast === 'boolean' ? { fast: model.fast } : {}),
      ...(Array.isArray(model.efforts) ? { efforts: [...model.efforts] } : {}),
      ...(isObject(model.effortLabels) ? { effortLabels: { ...model.effortLabels } } : {}),
    })),
    selected: {
      id: request.selected.id,
      effort: request.selected.effort,
      fast: request.selected.fast,
    },
    pinned: Array.isArray(request.pinned) ? [...request.pinned] : [],
  }
}

export function nativeAddonPath({ resourcesPath, appRoot, platform, arch }) {
  if (platform !== 'darwin' || arch !== 'arm64') return null
  if (typeof resourcesPath === 'string' && resourcesPath !== '') {
    return join(resourcesPath, 'native', 'atlas_native.node')
  }
  return join(appRoot, 'native', 'prebuilds', `${platform}-${arch}`, 'atlas_native.node')
}

export function loadNativeAddon({ resourcesPath, appRoot, platform, arch, require }) {
  const path = nativeAddonPath({ resourcesPath, appRoot, platform, arch })
  if (path === null) return null
  try {
    return require(path)
  } catch {
    return null
  }
}

export function createNativeModelPicker({ addon, log = console.error }) {
  const available = typeof addon === 'object' && addon !== null
  let attached = null
  let generation = 0
  let disposed = false

  const forward = (event) => {
    if (attached === null || attached.isDestroyed()) return
    try {
      attached.webContents.send(MODEL_PICKER_EVENT, event)
    } catch (error) {
      log('[native-picker] the event did not reach the window', error)
    }
  }

  const attach = ({ win }) => {
    if (!available || disposed) return
    attached = win
    try {
      addon.setWindowHandle(win.getNativeWindowHandle())
      addon.setEventCallback((event) => forward(event))
    } catch (error) {
      log('[native-picker] the panel did not attach', error)
    }
  }

  const detach = ({ win }) => {
    if (attached === win) attached = null
    if (!available) return
    try {
      addon.setWindowHandle(null)
      addon.hide(0)
    } catch (error) {
      log('[native-picker] the panel did not detach', error)
    }
  }

  const show = ({ win, request }) => {
    if (!available) return { ok: false, reason: 'no-addon' }
    if (disposed) return { ok: false, reason: 'disposed' }
    if (!validModelPickerRequest(request)) return { ok: false, reason: 'invalid-request' }
    if (attached !== win) attach({ win })
    let shown = 0
    try {
      shown = addon.show(pickerRequestOf(request))
    } catch (error) {
      log('[native-picker] the panel did not open', error)
      return { ok: false, reason: 'addon-failed' }
    }
    if (typeof shown !== 'number' || shown <= 0) return { ok: false, reason: 'not-shown' }
    generation = shown
    return { ok: true, generation }
  }

  const hide = ({ win }) => {
    if (!available) return
    if (attached !== null && attached !== win) return
    try {
      addon.hide(generation)
    } catch (error) {
      log('[native-picker] the panel did not close', error)
    }
    generation = 0
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    attached = null
    generation = 0
    if (!available) return
    try {
      addon.shutdown()
    } catch (error) {
      log('[native-picker] the panel did not shut down', error)
    }
  }

  return { available, attach, detach, show, hide, dispose }
}

export function registerModelPickerIpc({ ipcMain, picker, windowOf }) {
  const windowFor = (sender) => {
    const win = windowOf(sender)
    return win === undefined ? null : win
  }
  ipcMain.handle(MODEL_PICKER_SHOW, (event, request) => {
    const win = windowFor(event.sender)
    if (win === null) return { ok: false, reason: 'no-window' }
    return picker.show({ win, request })
  })
  ipcMain.handle(MODEL_PICKER_HIDE, (event) => {
    const win = windowFor(event.sender)
    if (win === null) return
    picker.hide({ win })
  })
}
