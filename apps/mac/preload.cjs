const { contextBridge, ipcRenderer } = require('electron')

const FULLSCREEN_STATE = 'atlas-desktop:fullscreen'
const FULLSCREEN_QUERY = 'atlas-desktop:is-fullscreen'
const PANE_NAVIGATED = 'atlas-desktop:pane-navigated'
const PANE_TITLED = 'atlas-desktop:pane-titled'
const MODEL_PICKER_SHOW = 'atlas-desktop:model-picker-show'
const MODEL_PICKER_HIDE = 'atlas-desktop:model-picker-hide'
const MODEL_PICKER_EVENT = 'atlas-desktop:model-picker-event'

const listeners = new Set()
const navigationListeners = new Set()
const titleListeners = new Set()
const modelPickerListeners = new Set()

ipcRenderer.on(FULLSCREEN_STATE, (_event, fullScreen) => {
  for (const listener of listeners) listener(fullScreen === true)
})

ipcRenderer.on(PANE_NAVIGATED, (_event, report) => {
  for (const listener of navigationListeners) listener(report)
})

ipcRenderer.on(PANE_TITLED, (_event, report) => {
  for (const listener of titleListeners) listener(report)
})

ipcRenderer.on(MODEL_PICKER_EVENT, (_event, report) => {
  for (const listener of modelPickerListeners) listener(report)
})

contextBridge.exposeInMainWorld('atlasDesktop', {
  nativeModelPicker: true,
  showModelPicker: (request) => ipcRenderer.invoke(MODEL_PICKER_SHOW, request),
  hideModelPicker: () => ipcRenderer.invoke(MODEL_PICKER_HIDE),
  onModelPickerEvent: (listener) => {
    modelPickerListeners.add(listener)
  },
  offModelPickerEvent: (listener) => {
    modelPickerListeners.delete(listener)
  },
  fullScreen: () => ipcRenderer.sendSync(FULLSCREEN_QUERY) === true,
  onFullScreenChange: (listener) => {
    listeners.add(listener)
  },
  offFullScreenChange: (listener) => {
    listeners.delete(listener)
  },
  onPaneNavigated: (listener) => {
    navigationListeners.add(listener)
  },
  offPaneNavigated: (listener) => {
    navigationListeners.delete(listener)
  },
  onPaneTitled: (listener) => {
    titleListeners.add(listener)
  },
  offPaneTitled: (listener) => {
    titleListeners.delete(listener)
  },
})
