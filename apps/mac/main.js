import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

import { app, BrowserWindow, ipcMain, WebContentsView } from 'electron'
import { Notification, pushNotifications, session as electronSession } from 'electron'
// electron-updater ships CommonJS and builds `autoUpdater` behind a getter, so it is read here
// rather than destructured by the ESM loader.
import electronUpdater from 'electron-updater'

import { createApnsBridge, sessionIdOfLaunchInfo, userInfoOfLaunchInfo } from './apns.js'
import {
  createDeepLinkOpener,
  deepLinkOf,
  landingUrlOf,
  launchPlanOf,
  protocolClientArgsOf,
} from './deep-links.js'
import { errorPage, startDesktopServer } from './desktop-server.js'
import { hostEnvironment, resolveBun, resolveHostScript, webRootAt } from './host-paths.js'
import { ENavigation, paneNavigationOf, sameOrigin, windowNavigationOf } from './links.js'
import { attachContextMenu, denyWindow, sendToBrowser } from './window-chrome.js'
import { createHostLauncher } from './host-launch.js'
import { createHostTrust } from './host-trust.js'
import { createClickWatcher, createSessionOpener, revealWindow } from './notification-clicks.js'
import {
  createNativeModelPicker,
  loadNativeAddon,
  registerModelPickerIpc,
} from './native-picker.js'
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

const hostTrust = createHostTrust({ sessionOf: () => electronSession.defaultSession })

const apns = createApnsBridge({
  secret: desktopSecret,
  notifications: Notification,
  pushes: pushNotifications,
})

ipcMain.on(FULLSCREEN_QUERY, (event) => {
  event.returnValue = BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false
})

const nativePicker = createNativeModelPicker({
  addon: loadNativeAddon({
    resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
    appRoot: app.getAppPath(),
    platform: process.platform,
    arch: process.arch,
    require: createRequire(import.meta.url),
  }),
})

registerModelPickerIpc({
  ipcMain,
  picker: nativePicker,
  windowOf: (sender) => BrowserWindow.fromWebContents(sender),
})

async function createWindow({ sessionId, path } = {}) {
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

  hostTrust.install()
  nativePicker.attach({ win })

  win.on('enter-full-screen', () => win.webContents.send(FULLSCREEN_STATE, true))
  win.on('leave-full-screen', () => win.webContents.send(FULLSCREEN_STATE, false))
  win.webContents.setWindowOpenHandler(({ url }) => denyWindow(url))
  win.webContents.on('will-navigate', (event) => {
    const plan = windowNavigationOf({ url: event.url, pageUrl: win.webContents.getURL() })
    if (plan.kind === ENavigation.Stay) return
    if (deepLinkOf(event.url) !== null) {
      event.preventDefault()
      openDeepLink(event.url)
      return
    }
    sendToBrowser({ event, url: plan.url })
  })
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
      view.webContents.on('will-navigate', (event) => {
        const plan = paneNavigationOf(event.url)
        if (plan.kind === ENavigation.Browser) sendToBrowser({ event, url: plan.url })
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

  const startSession = createHostLauncher({
    trust: (fingerprint) => hostTrust.trust(fingerprint),
    apns,
    script,
    bun,
    environmentOf: (webRoot) =>
      hostEnvironment({
        base: { ...process.env, ATLAS_SECRET: desktopSecret },
        paneOrigin: session.origin,
        updateOrigin: session.origin,
        webRoot,
        appVersion: app.getVersion(),
      }),
    log: (error) => console.error('[desktop-host] the host did not start', error),
  })

  // A new interface is installed in the background and waits for the person to take it: the web app
  // asks for this route and reloads itself when the window is in the background, so no update ever
  // pulls the page out from under a half-written message.
  const swapTo = async ({ hash }) => {
    const next = startSession(payloadWebRoot({ home, hash }))
    try {
      const { url } = await next.page
      await win.loadURL(url)
      host?.child.kill('SIGTERM')
      host = next
      payloads.updater.applied()
      console.log(`[web-payload] swapped the interface to ${hash}`)
      return true
    } catch (error) {
      next.child.kill('SIGTERM')
      console.error('[web-payload] the new interface did not start; keeping this one', error)
      void host?.page.then((page) => apns.attach(page.httpOrigin)).catch(() => undefined)
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
    nativePicker.detach({ win })
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
      await win.loadURL(landingUrlOf({ pageUrl: (await host.page).url, sessionId, path }))
    } catch (error) {
      if (installedHash === undefined) throw error
      console.error('[web-payload] the installed interface failed; using the bundled one', error)
      await payloads.updater.fail({ hash: installedHash })
      host = startSession(bundledRoot)
      await win.loadURL(landingUrlOf({ pageUrl: (await host.page).url, sessionId, path }))
    }
    payloads.start()
    binary.start()
  } catch (error) {
    await win.loadURL(errorPage(error))
  }

  return win
}

let launchSessionId

const windowNow = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]

const openDeepLink = createDeepLinkOpener({
  windowNow,
  createWindow,
  reveal: (win) => revealWindow({ app, win }),
  log: (line) => console.error(line),
})

const launchLinks = []
let launched = false

app.on('open-url', (event, url) => {
  event.preventDefault()
  if (launched) openDeepLink(url)
  else launchLinks.push(url)
})

const protocolClient = protocolClientArgsOf({
  defaultApp: process.defaultApp === true,
  execPath: process.execPath,
  entry: process.argv[1] === undefined ? undefined : resolve(process.argv[1]),
})
if (protocolClient !== null) app.setAsDefaultProtocolClient(...protocolClient)

app.on('ready', (_event, launchInfo) => {
  launchSessionId = sessionIdOfLaunchInfo(launchInfo)
  if (launchSessionId !== undefined) void apns.opened(userInfoOfLaunchInfo(launchInfo))
})

const openSession = createSessionOpener({ app, windowNow, createWindow })

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
  const launch = launchPlanOf(launchLinks.splice(0))
  const created = createWindow({ sessionId: launchSessionId, path: launch.path })
  launched = true
  for (const link of launch.replay) openDeepLink(link)
  await created
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  nativePicker.dispose()
})
