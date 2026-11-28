const { contextBridge, ipcRenderer } = require('electron')

const FULLSCREEN_STATE = 'atlas-desktop:fullscreen'
const FULLSCREEN_QUERY = 'atlas-desktop:is-fullscreen'
const PANE_NAVIGATED = 'atlas-desktop:pane-navigated'
const PANE_TITLED = 'atlas-desktop:pane-titled'
const PAGE_NAVIGATE = 'atlas-desktop:navigate'

const listeners = new Set()
const navigationListeners = new Set()
const pageNavigationListeners = new Set()
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

ipcRenderer.on(PAGE_NAVIGATE, (_event, request) => {
  for (const listener of pageNavigationListeners) {
    try {
      if (listener(request.path) !== true) continue
      ipcRenderer.send(PAGE_NAVIGATE, { requestId: request.requestId })
      return
    } catch {}
  }
})

contextBridge.exposeInMainWorld('atlasDesktop', {
  onNavigate: (listener) => {
    pageNavigationListeners.add(listener)
  },
  offNavigate: (listener) => {
    pageNavigationListeners.delete(listener)
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
