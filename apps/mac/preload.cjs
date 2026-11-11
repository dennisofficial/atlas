const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('atlasDesktop', {})
