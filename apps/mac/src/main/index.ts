import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import Electrobun, {
  ApplicationMenu,
  BrowserWindow,
  BuildConfig,
  PATHS,
  Updater,
  Utils,
} from 'electrobun/main'
import { createDesktopHost } from '../host'
import { bunPath, startNextServer } from '../host/next-server'
import { startOnStablePort } from '../host/stable-port'
import { defaultDesktopHome, podConfigFromEnv } from '../host/pods/config'
import { resolveServeVersion } from '../host/pods/serve-version'
import { EMenuAction, installApplicationMenu } from './menu'
import { checkNow, EManualCheckOutcome, restartToPrepared, startAutoUpdate } from './auto-update'
import { runCheckForUpdates } from './check-for-updates'
import { createUpdateState } from './update-state'
import { EDesktopUpdateState } from '../host/update-routes'
import { DESKTOP_PRELOAD } from './preload'
import { runLogged, writeLog } from './crash-log'
import { type IExternalLinkRouter, routeExternalLinks } from './external-links-wiring'
import { syncFullscreen } from './fullscreen'
import { deepLinkTargetOf, openUrlOf, previewCallbackPathOf } from './deep-link'
import { externalUrlOf } from './external-links'
import { navigateScript, previewCallbackScript, RELOAD_SCRIPT } from './in-app-navigation'
import { readDoubleClickAction, runTitlebarAction } from './titlebar-action'

const earlyLinks: string[] = []
const deepLinkRef: { open?: (link: string) => void } = {}
Electrobun.events.on('open-url', (event: unknown) => {
  const link = openUrlOf(event)
  if (link === null) return
  if (deepLinkRef.open) deepLinkRef.open(link)
  else earlyLinks.push(link)
})

await runLogged(async () => {
  const localInfo = await Updater.getLocalInfo()
  const chromium = BuildConfig.getSync().availableRenderers.includes('cef')
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
  const home = defaultDesktopHome()
  const nextServer = await startNextServer({
    root: join(PATHS.RESOURCES_FOLDER, 'app', 'web', 'apps', 'web'),
    bunPath: bunPath(),
  })
  const startHost = (port: number) =>
    createDesktopHost({
      port,
      appOrigin: nextServer.origin,
      secret,
      pods: podConfig,
      app: { version: localInfo.version, channel: localInfo.channel, chromium },
      auth: { home, openExternal: (url) => Utils.openExternal(url) },
      updates: {
        status: updateState.status,
        check: async () => {
          const result = await checkNow({ updater: Updater, onReady: updateState.markReady })
          if (result.outcome === EManualCheckOutcome.Failed) {
            return { state: EDesktopUpdateState.Idle, error: result.message }
          }
          return updateState.status()
        },
        restart: () => restartToPrepared({ updater: Updater, state: updateState }),
      },
      window: {
        titlebarDoubleClick: () => {
          if (windowRef.current)
            runTitlebarAction({
              win: windowRef.current,
              action: doubleClickAction,
            })
        },
        setPreviewOrigins: (origins) => linksRef.current?.setFrameOrigins(origins),
      },
    })
  const host = startOnStablePort({ home, start: startHost })

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
  const focusWindow = () => {
    if (win.isMinimized()) win.unminimize()
    win.activate()
  }
  deepLinkRef.open = (link) => {
    const callbackPath = previewCallbackPathOf(link)
    if (callbackPath !== null) {
      win.webview.executeJavascript(previewCallbackScript(callbackPath) ?? '')
      focusWindow()
      return
    }
    const target = deepLinkTargetOf({ link, hostUrl: host.url, secret })
    if (target === null) return
    win.webview.loadURL(target)
    focusWindow()
  }
  for (const link of earlyLinks.splice(0)) deepLinkRef.open(link)
  linksRef.current = routeExternalLinks({
    webview: win.webview,
    onNewWindow: (handler) =>
      void Electrobun.events.on(`new-window-open-${win.webview.id}`, handler),
    hostOrigin: new URL(host.url).origin,
    openExternal: (url) => Utils.openExternal(externalUrlOf(url)),
  })

  installApplicationMenu()
  startAutoUpdate({
    updater: Updater,
    onReady: updateState.markReady,
  })

  ApplicationMenu.on('application-menu-clicked', (event: unknown) => {
    const action = (event as { data?: { action?: string } }).data?.action
    if (action === EMenuAction.Settings)
      win.webview.executeJavascript(navigateScript('/settings') ?? '')
    if (action === EMenuAction.CheckForUpdates)
      void runCheckForUpdates({ state: updateState }).catch((error: unknown) =>
        writeLog({ label: 'check-for-updates', error }),
      )
    if (action === EMenuAction.Reload) win.webview.executeJavascript(RELOAD_SCRIPT)
    if (action === EMenuAction.ToggleDevTools) win.webview.toggleDevTools()
  })

  Electrobun.events.on('before-quit', () => {
    void host.stop()
    void nextServer.stop()
  })
})
