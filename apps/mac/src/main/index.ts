import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import Electrobun, { ApplicationMenu, BrowserWindow, PATHS, Updater, Utils } from 'electrobun/main'
import { createDesktopHost } from '../host'
import { defaultDesktopHome, podConfigFromEnv } from '../host/pods/config'
import { resolveServeVersion } from '../host/pods/serve-version'
import { EMenuAction, installApplicationMenu } from './menu'
import { restartToLatest, startAutoUpdate } from './auto-update'
import { runCheckForUpdates } from './check-for-updates'
import { createUpdateState } from './update-state'
import { DESKTOP_PRELOAD } from './preload'
import { runLogged, writeLog } from './crash-log'
import { type IExternalLinkRouter, routeExternalLinks } from './external-links-wiring'
import { syncFullscreen } from './fullscreen'
import { readDoubleClickAction, runTitlebarAction } from './titlebar-action'

await runLogged(async () => {
  const localInfo = await Updater.getLocalInfo()
  const serveVersion = resolveServeVersion({
    envVersion: process.env.ATLAS_SERVE_VERSION,
    channel: localInfo.channel,
    appVersion: localInfo.version,
  })
  const secret = randomBytes(32).toString('hex')
  const podConfig = podConfigFromEnv({ env: process.env, serveVersion })
  const updateState = createUpdateState()
  const doubleClickAction = await readDoubleClickAction()
  const windowRef: { current?: BrowserWindow } = {}
  const linksRef: { current?: IExternalLinkRouter } = {}
  const host = createDesktopHost({
    webRoot: join(PATHS.RESOURCES_FOLDER, 'app', 'web'),
    secret,
    pods: podConfig,
    app: { version: localInfo.version, channel: localInfo.channel },
    auth: { home: defaultDesktopHome(), openExternal: (url) => Utils.openExternal(url) },
    updates: {
      status: updateState.status,
      restart: () => restartToLatest({ updater: Updater, onReady: updateState.markReady }),
    },
    window: {
      titlebarDoubleClick: () => {
        if (windowRef.current)
          runTitlebarAction({ win: windowRef.current, action: doubleClickAction })
      },
      setPreviewOrigins: (origins) => linksRef.current?.setFrameOrigins(origins),
    },
  })

  const win = new BrowserWindow({
    title: 'Atlas',
    url: `${host.url}/desktop/session?secret=${secret}`,
    frame: { width: 1280, height: 820 },
    preload: DESKTOP_PRELOAD,
    titleBarStyle: 'hiddenInset',
    trafficLightOffset: { x: 8, y: 8 },
  })
  windowRef.current = win

  syncFullscreen({ win })
  linksRef.current = routeExternalLinks({
    webview: win.webview,
    onNewWindow: (handler) =>
      void Electrobun.events.on(`new-window-open-${win.webview.id}`, handler),
    hostOrigin: new URL(host.url).origin,
    openExternal: (url) => Utils.openExternal(url),
  })

  installApplicationMenu()
  startAutoUpdate({
    updater: Updater,
    onReady: updateState.markReady,
  })

  ApplicationMenu.on('application-menu-clicked', (event: unknown) => {
    const action = (event as { data?: { action?: string } }).data?.action
    if (action === EMenuAction.Settings) win.webview.loadURL(`${host.url}/settings`)
    if (action === EMenuAction.CheckForUpdates)
      void runCheckForUpdates({ onReady: updateState.markReady }).catch((error: unknown) =>
        writeLog({ label: 'check-for-updates', error }),
      )
    if (action === EMenuAction.Reload) win.webview.loadURL(win.webview.url ?? host.url)
    if (action === EMenuAction.ToggleDevTools) win.webview.toggleDevTools()
  })

  Electrobun.events.on('before-quit', () => {
    void host.stop()
  })
})
