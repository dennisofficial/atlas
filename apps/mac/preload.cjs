const { contextBridge, ipcRenderer } = require('electron')

const FULLSCREEN_STATE = 'atlas-desktop:fullscreen'
const FULLSCREEN_QUERY = 'atlas-desktop:is-fullscreen'
const listeners = new Set()

ipcRenderer.on(FULLSCREEN_STATE, (_event, fullScreen) => {
  for (const listener of listeners) listener(fullScreen === true)
})

contextBridge.exposeInMainWorld('atlasDesktop', {
  fullScreen: () => ipcRenderer.sendSync(FULLSCREEN_QUERY) === true,
  onFullScreenChange: (listener) => {
    listeners.add(listener)
  },
  offFullScreenChange: (listener) => {
    listeners.delete(listener)
  },
})
