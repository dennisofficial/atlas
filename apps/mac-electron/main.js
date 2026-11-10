import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { app, BrowserWindow, dialog, WebContentsView } from 'electron'

import { startDesktopHost } from './host-process.js'
import { createPaneController } from './pane-controller.js'
import { startPaneServer } from './pane-server.js'

const WINDOW_WIDTH = 1280
const WINDOW_HEIGHT = 820
const PANE_PARTITION = 'persist:atlas-pane'

const repoRoot = resolve(app.getAppPath(), '..', '..')
const hostScript =
  process.env.ATLAS_HOST_SCRIPT ?? join(repoRoot, 'apps/mac/src/desktop-host/index.ts')

const log = (line) => console.log(`[shell] ${line}`)

let activePane = null
let sessionUrl = null
let host = null
let paneServer = null

function contentSize(win) {
  const [width, height] = win.getContentSize()
  return { width, height }
}

function createWindow() {
  const win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    resizable: true,
    titleBarStyle: 'hiddenInset',
    show: false,
  })

  const pane = createPaneController({
    contentView: win.contentView,
    contentSize: contentSize(win),
    createView: () =>
      new WebContentsView({
        webPreferences: { partition: PANE_PARTITION, contextIsolation: true },
      }),
    log,
  })

  activePane = pane
  win.on('resize', () => pane.setContentSize(contentSize(win)))
  win.on('closed', () => {
    activePane = null
    pane.destroy()
  })
  win.once('ready-to-show', () => win.show())
  return win
}

async function startHost() {
  if (!existsSync(hostScript))
    throw new Error(
      `the desktop host is missing at ${hostScript}; a packaged app needs host.js beside main.js (set ATLAS_HOST_SCRIPT)`,
    )
  paneServer = await startPaneServer({
    apply: (command) => activePane?.apply(command) ?? { ok: false, error: 'no window' },
  })
  log(`pane listener on ${paneServer.origin}`)
  host = await startDesktopHost({
    script: hostScript,
    cwd: repoRoot,
    paneOrigin: paneServer.origin,
    env: process.env,
    log,
  })
  return host.url
}

async function launch() {
  const win = createWindow()
  try {
    sessionUrl ??= await startHost()
  } catch (error) {
    log(`desktop host failed: ${error.message}`)
    dialog.showErrorBox('Atlas could not start', error.message)
    app.quit()
    return
  }
  win.loadURL(sessionUrl)
}

app.whenReady().then(() => {
  void launch()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void launch()
  })
})

app.on('will-quit', () => {
  host?.stop()
  void paneServer?.close()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
