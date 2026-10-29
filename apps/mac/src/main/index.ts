import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import Electrobun, { ApplicationMenu, BrowserWindow, PATHS, Updater } from 'electrobun/main'
import { createDesktopHost } from '../host'
import { podConfigFromEnv } from '../host/pods/config'
import { resolveServeVersion } from '../host/pods/serve-version'
import { EMenuAction, installApplicationMenu } from './menu'
import { applyVibrancy, VIBRANCY_PRELOAD, vibrancySupported } from './vibrancy'

const localInfo = await Updater.getLocalInfo()
const serveVersion = resolveServeVersion({
  envVersion: process.env.ATLAS_SERVE_VERSION,
  channel: localInfo.channel,
  appVersion: localInfo.version,
})
const vibrant = vibrancySupported()
const secret = randomBytes(32).toString('hex')
const host = createDesktopHost({
  webRoot: join(PATHS.RESOURCES_FOLDER, 'app', 'web'),
  secret,
  pods: podConfigFromEnv({ env: process.env, serveVersion }),
})

const win = new BrowserWindow({
  title: 'Atlas',
  url: `${host.url}/desktop/session?secret=${secret}`,
  frame: { width: 1280, height: 820 },
  titleBarStyle: 'hiddenInset',
  trafficLightOffset: { x: 14, y: 14 },
  transparent: vibrant,
  preload: vibrant ? VIBRANCY_PRELOAD : null,
})

if (vibrant) {
  applyVibrancy({ windowPtr: win.ptr, width: win.frame.width, height: win.frame.height })
}

installApplicationMenu()

ApplicationMenu.on('application-menu-clicked', (event: unknown) => {
  const action = (event as { data?: { action?: string } }).data?.action
  if (action === EMenuAction.Settings) win.webview.loadURL(`${host.url}/settings`)
  if (action === EMenuAction.Reload) win.webview.loadURL(win.webview.url ?? host.url)
  if (action === EMenuAction.ToggleDevTools) win.webview.toggleDevTools()
})

Electrobun.events.on('before-quit', () => {
  void host.stop()
})
