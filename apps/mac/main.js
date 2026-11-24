import { join } from 'node:path'

import { app, BrowserWindow, clipboard, ipcMain, Menu, WebContentsView, shell } from 'electron'
import { Notification, pushNotifications } from 'electron'
// electron-updater ships CommonJS and builds `autoUpdater` behind a getter, so it is read here
// rather than destructured by the ESM loader.
import electronUpdater from 'electron-updater'

import {
  createApnsBridge,
  sessionIdOfLaunchInfo,
  urlForSession,
  userInfoOfLaunchInfo,
} from './apns.js'
import { contextMenuTemplate } from './context-menu.js'
import { errorPage, startDesktopServer } from './desktop-server.js'
import { hostEnvironment, resolveBun, resolveHostScript, webRootAt } from './host-paths.js'
import { externalUrlOf, sameOrigin } from './links.js'
import { startHost } from './host-process.js'
import { createClickWatcher, createSessionOpener } from './notification-clicks.js'
import { createPaneRegistry } from './panes.js'
import { createBinaryUpdater, createDesktopUpdates } from './updates.js'
import {
  createElectronWebUpdater,
  manifestUrlOf,
  payloadHomeOf,
  payloadWebRoot,
  webRootFor,
} from './web-payload.js'

const FULLSCREEN_STATE = 'atlas-desktop:fullscreen'
const FULLSCREEN_QUERY = 'atlas-desktop:is-fullscreen'
const PANE_NAVIGATED = 'atlas-desktop:pane-navigated'
const PANE_TITLED = 'atlas-desktop:pane-titled'
const PANE_PARTITION = 'persist:spike'
const WINDOW_WIDTH = 1280
const WINDOW_HEIGHT = 820

const { autoUpdater } = electronUpdater

const desktopSecret = process.env.ATLAS_SECRET ?? crypto.randomUUID()

const apns = createApnsBridge({
  secret: desktopSecret,
  notifications: Notification,
  pushes: pushNotifications,
})

ipcMain.on(FULLSCREEN_QUERY, (event) => {
  event.returnValue = BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false
})

function openInBrowser(url) {
  const external = externalUrlOf(url)
  if (external !== null) void shell.openExternal(external)
}

function denyWindow(url) {
  openInBrowser(url)
  return { action: 'deny' }
}

function attachContextMenu({ win, contents }) {
  contents.on('context-menu', (_event, params) => {
    const template = contextMenuTemplate({
      params,
      openLink: openInBrowser,
      copyText: (text) => clipboard.writeText(text),
      copyImage: ({ x, y }) => contents.copyImageAt(x, y),
      replaceMisspelling: (word) => contents.replaceMisspelling(word),
      learnSpelling: (word) => contents.session.addWordToSpellCheckerDictionary(word),
    })
    if (template.length === 0) return
    Menu.buildFromTemplate(template).popup({ window: win })
  })
}

async function createWindow({ sessionId } = {}) {
  const win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    resizable: true,
    titleBarStyle: 'hiddenInset',
    // The web app draws its own titlebar, its drag regions and the traffic-light inset once it sees
    // this bridge; without it the window cannot be moved by the page's own chrome.
    webPreferences: {
      preload: join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
    },
  })

  win.on('enter-full-screen', () => win.webContents.send(FULLSCREEN_STATE, true))
  win.on('leave-full-screen', () => win.webContents.send(FULLSCREEN_STATE, false))
  win.webContents.setWindowOpenHandler(({ url }) => denyWindow(url))
  attachContextMenu({ win, contents: win.webContents })

  const panes = createPaneRegistry({
    create: () => {
      const view = new WebContentsView({
        webPreferences: { partition: PANE_PARTITION, contextIsolation: true },
      })
      view.webContents.setWindowOpenHandler(({ url }) => {
        if (!sameOrigin(url, view.webContents.getURL())) return denyWindow(url)
        void view.webContents.loadURL(url)
        return { action: 'deny' }
      })
      attachContextMenu({ win, contents: view.webContents })
      win.contentView.addChildView(view)
      view.setVisible(false)
      return view
    },
    release: (view) => {
      if (!win.isDestroyed()) win.contentView.removeChildView(view)
      if (!view.webContents.isDestroyed()) view.webContents.close()
    },
    onNavigate: (report) => {
      if (!win.isDestroyed()) win.webContents.send(PANE_NAVIGATED, report)
    },
    onTitle: (report) => {
      if (!win.isDestroyed()) win.webContents.send(PANE_TITLED, report)
    },
  })

  const script = resolveHostScript({
    env: process.env,
    resourcesPath: process.resourcesPath,
    appRoot: app.getAppPath(),
  })
  const bun = resolveBun({ env: process.env, resourcesPath: process.resourcesPath })
  const home = payloadHomeOf({ userData: app.getPath('userData') })
  const bundledRoot = webRootAt({ resourcesPath: process.resourcesPath })
  const payloads = createElectronWebUpdater({
    home,
    manifestUrl: manifestUrlOf({ env: process.env }),
    appVersion: app.getVersion(),
  })
  const binary = createBinaryUpdater({ autoUpdater, enabled: app.isPackaged })

  let host
  let session

  const startSession = (webRoot) => {
    const started = startHost({
      script,
      bun,
      environment: hostEnvironment({
        base: { ...process.env, ATLAS_SECRET: desktopSecret },
        paneOrigin: session.origin,
        updateOrigin: session.origin,
        webRoot,
        appVersion: app.getVersion(),
      }),
    })
    void started.url.then((url) => apns.attach(url)).catch(() => undefined)
    return started
  }

  // A new interface is installed in the background and waits for the person to take it: the web app
  // asks for this route and reloads itself when the window is in the background, so no update ever
  // pulls the page out from under a half-written message.
  const swapTo = async ({ hash }) => {
    const next = startSession(payloadWebRoot({ home, hash }))
    try {
      const url = await next.url
      await win.loadURL(url)
      host?.child.kill('SIGTERM')
      host = next
      payloads.updater.applied()
      console.log(`[web-payload] swapped the interface to ${hash}`)
      return true
    } catch (error) {
      next.child.kill('SIGTERM')
      console.error('[web-payload] the new interface did not start; keeping this one', error)
      void host?.url.then((url) => apns.attach(url)).catch(() => undefined)
      await payloads.updater.fail({ hash })
      return false
    }
  }

  const updates = createDesktopUpdates({
    payloads: { updater: payloads.updater, check: payloads.check, swap: swapTo },
    binary,
  })

  session = await startDesktopServer({ panes, updates })

  win.on('closed', () => {
    payloads.stop()
    binary.stop()
    host?.child.kill('SIGTERM')
    session.server.close()
    panes.destroy()
  })

  try {
    const installedHash = await payloads.updater.installedRoot()
    try {
      host = startSession(webRootFor({ home, bundledRoot, installedHash }))
      await win.loadURL(urlForSession(await host.url, sessionId))
    } catch (error) {
      if (installedHash === undefined) throw error
      console.error('[web-payload] the installed interface failed; using the bundled one', error)
      await payloads.updater.fail({ hash: installedHash })
      host = startSession(bundledRoot)
      await win.loadURL(urlForSession(await host.url, sessionId))
    }
    payloads.start()
    binary.start()
  } catch (error) {
    await win.loadURL(errorPage(error))
  }

  return win
}

let launchSessionId

app.on('ready', (_event, launchInfo) => {
  launchSessionId = sessionIdOfLaunchInfo(launchInfo)
  if (launchSessionId !== undefined) void apns.opened(userInfoOfLaunchInfo(launchInfo))
})

const openSession = createSessionOpener({
  app,
  windowNow: () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0],
  createWindow,
})

const clicks = createClickWatcher({
  notifications: Notification,
  onClick: openSession,
  log: (line) => console.error(line),
})

app.whenReady().then(async () => {
  if (app.isPackaged) {
    void apns.start()
    void clicks.start({ pushes: pushNotifications, app })
  }
  await createWindow({ sessionId: launchSessionId })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
