const { contextBridge, ipcRenderer } = require('electron')

const FULLSCREEN_STATE = 'atlas-desktop:fullscreen'
const FULLSCREEN_QUERY = 'atlas-desktop:is-fullscreen'
const PANE_NAVIGATED = 'atlas-desktop:pane-navigated'
const PANE_TITLED = 'atlas-desktop:pane-titled'

const listeners = new Set()
const navigationListeners = new Set()
const titleListeners = new Set()

ipcRenderer.on(FULLSCREEN_STATE, (_event, fullScreen) => {
  for (const listener of listeners) listener(fullScreen === true)
})

ipcRenderer.on(PANE_NAVIGATED, (_event, report) => {
  for (const listener of navigationListeners) listener(report)
})

ipcRenderer.on(PANE_TITLED, (_event, report) => {
  for (const listener of titleListeners) listener(report)
})

contextBridge.exposeInMainWorld('atlasDesktop', {
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
