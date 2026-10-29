import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import Electrobun, { ApplicationMenu, BrowserWindow, PATHS, Updater, Utils } from 'electrobun/main'
import { createDesktopHost } from '../host'
import { podConfigFromEnv } from '../host/pods/config'
import { resolveServeVersion } from '../host/pods/serve-version'
import { EMenuAction, installApplicationMenu } from './menu'
import { startAutoUpdate } from './auto-update'
import { runLogged } from './crash-log'

await runLogged(async () => {
  const localInfo = await Updater.getLocalInfo()
  const serveVersion = resolveServeVersion({
    envVersion: process.env.ATLAS_SERVE_VERSION,
    channel: localInfo.channel,
    appVersion: localInfo.version,
  })
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
  })

  installApplicationMenu()
  startAutoUpdate({
    updater: Updater,
    prompt: async () => {
      const { response } = await Utils.showMessageBox({
        type: 'question',
        title: 'Update ready',
        message: 'A new version of Atlas is ready.',
        detail: 'Restart to finish updating.',
        buttons: ['Restart to update', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      return response === 0
    },
    apply: () => Updater.applyUpdate(),
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
