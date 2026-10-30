import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import Electrobun, { ApplicationMenu, BrowserWindow, PATHS, Updater, Utils } from 'electrobun/main'
import { createDesktopHost } from '../host'
import { podConfigFromEnv } from '../host/pods/config'
import { resolveServeVersion } from '../host/pods/serve-version'
import { EMenuAction, installApplicationMenu } from './menu'
import { startAutoUpdate } from './auto-update'
import { createUpdateState } from './update-state'
import { DESKTOP_PRELOAD } from './preload'
import { runLogged } from './crash-log'
import { routeExternalLinks } from './external-links-wiring'
import { syncFullscreen } from './fullscreen'

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
  const host = createDesktopHost({
    webRoot: join(PATHS.RESOURCES_FOLDER, 'app', 'web'),
    secret,
    pods: podConfig,
    auth: { home: podConfig.home, openExternal: (url) => Utils.openExternal(url) },
    updates: { status: updateState.status, restart: () => Updater.applyUpdate() },
  })

  const win = new BrowserWindow({
    title: 'Atlas',
    url: `${host.url}/desktop/session?secret=${secret}`,
    frame: { width: 1280, height: 820 },
    preload: DESKTOP_PRELOAD,
    titleBarStyle: 'hiddenInset',
    trafficLightOffset: { x: 14, y: 14 },
  })

  syncFullscreen({ win })
  routeExternalLinks({
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
    if (action === EMenuAction.Reload) win.webview.loadURL(win.webview.url ?? host.url)
    if (action === EMenuAction.ToggleDevTools) win.webview.toggleDevTools()
  })

  Electrobun.events.on('before-quit', () => {
    void host.stop()
  })
})
