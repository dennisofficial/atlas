import { randomBytes } from 'node:crypto'
import Electrobun, {
  ApplicationMenu,
  BrowserWindow,
  BuildConfig,
  PATHS,
  Updater,
  Utils,
} from 'electrobun/main'
import { createDesktopHost } from '../host'
import { DESKTOP_CONTRACT } from '../host/contract'
import { bunPath } from '../host/next-server'
import { bunWebPayloadFs, downloadBytes, fetchJson, sha256Of } from '../host/web-payload/ports'
import { createWebUpdater } from '../host/web-payload/updater'
import { startAppServer } from './app-server'
import { bundledWebRoot, manifestUrlOf, payloadWebRoot, webRootOverrideOf } from './web-ota'
import { startOnStablePort } from '../host/stable-port'
import { defaultDesktopHome, podConfigFromEnv } from '../host/pods/config'
import { resolveServeVersion } from '../host/pods/serve-version'
import { runAbout } from './about'
import { EMenuAction, installApplicationMenu } from './menu'
import { checkNow, EManualCheckOutcome, restartToPrepared, startAutoUpdate } from './auto-update'
import { runCheckForUpdates } from './check-for-updates'
import { createUpdateState } from './update-state'
import { EDesktopUpdateState } from '../host/update-routes'
import { DESKTOP_PRELOAD } from './preload'
import { PANE_RENDERER_ENV, paneRendererOf } from './pane-renderer'
import { runLogged, writeLog } from './crash-log'
import { type IExternalLinkRouter, routeExternalLinks } from './external-links-wiring'
import { syncFullscreen } from './fullscreen'
import { clearChildViews } from './clear-preview-views'
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

async function showStartupFailure({
  error,
  path,
}: {
  error: unknown
  path: string
}): Promise<void> {
  await Utils.showMessageBox({
    type: 'error',
    title: 'Atlas could not start',
    message: 'Atlas could not start.',
    detail: `${error instanceof Error ? error.message : String(error)}\n\nDetails are in ${path}`,
    buttons: ['Quit'],
  })
}

const startApp = async () => {
  const localInfo = await Updater.getLocalInfo()
  const chromium =
    paneRendererOf({
      available: BuildConfig.getSync().availableRenderers,
      requested: process.env[PANE_RENDERER_ENV],
    }) === 'cef'
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
  const bundledRoot = bundledWebRoot({ resourcesFolder: PATHS.RESOURCES_FOLDER })
  const webUpdater = createWebUpdater({
    home,
    manifestUrl: manifestUrlOf({ env: process.env }),
    contract: DESKTOP_CONTRACT,
    appVersion: localInfo.version,
    ports: {
      fs: bunWebPayloadFs(),
      fetchJson,
      download: downloadBytes,
      sha256: sha256Of,
      log: writeLog,
      setInterval: (handler, ms) => setInterval(handler, ms),
      clearInterval: (timer) => clearInterval(timer),
    },
  })
  const overrideRoot = webRootOverrideOf({ env: process.env })
  const installedHash = overrideRoot === undefined ? await webUpdater.installedRoot() : undefined
  const appServer = await startAppServer({
    root:
      overrideRoot ??
      (installedHash === undefined ? bundledRoot : payloadWebRoot({ home, hash: installedHash })),
    fallback: bundledRoot,
    bunPath: bunPath(),
  })
  if (appServer.usedFallback() && installedHash !== undefined)
    await webUpdater.fail({ hash: installedHash })
  const applyWebPayload = async (): Promise<boolean> => {
    const hash = webUpdater.pending() ?? (await webUpdater.installedRoot())
    if (hash === undefined) return false
    try {
      const result = await appServer.restart({
        root: payloadWebRoot({ home, hash }),
        fallback: bundledRoot,
      })
      if (result.usedFallback) {
        await webUpdater.fail({ hash })
        return false
      }
    } catch (error) {
      writeLog({ label: 'web-payload-restart', error })
      return false
    }
    webUpdater.applied()
    windowRef.current?.webview.executeJavascript(RELOAD_SCRIPT)
    return true
  }
  const startHost = (port: number) =>
    createDesktopHost({
      port,
      appOrigin: () => appServer.origin(),
      secret,
      pods: podConfig,
      app: { version: localInfo.version, channel: localInfo.channel, chromium },
      previewViews: { clear: () => void clearChildViews(windowRef.current?.webview.id) },
      auth: { home, openExternal: (url) => Utils.openExternal(url) },
      updates: {
        status: () => ({ ...updateState.status(), web: webUpdater.status() }),
        check: async () => {
          const result = await checkNow({ updater: Updater, onReady: updateState.markReady })
          const web = await webUpdater.check()
          if (result.outcome === EManualCheckOutcome.Failed) {
            return { state: EDesktopUpdateState.Idle, error: result.message, web }
          }
          return { ...updateState.status(), web }
        },
        restart: async () => {
          if (updateState.status().state === EDesktopUpdateState.Ready) {
            await restartToPrepared({ updater: Updater, state: updateState })
            return
          }
          await applyWebPayload()
        },
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
  webUpdater.start()

  ApplicationMenu.on('application-menu-clicked', (event: unknown) => {
    const action = (event as { data?: { action?: string } }).data?.action
    if (action === EMenuAction.About)
      void (async () => {
        const version = await webUpdater.installedVersion()
        await runAbout({
          app: { version: localInfo.version, channel: localInfo.channel, chromium },
          iface: version === undefined ? undefined : { version },
        })
      })().catch((error: unknown) => writeLog({ label: 'about', error }))
    if (action === EMenuAction.Settings)
      win.webview.executeJavascript(navigateScript('/settings') ?? '')
    if (action === EMenuAction.CheckForUpdates)
      void runCheckForUpdates({
        state: updateState,
        web: { check: () => webUpdater.check(), apply: applyWebPayload },
      }).catch((error: unknown) => writeLog({ label: 'check-for-updates', error }))
    if (action === EMenuAction.Reload) win.webview.executeJavascript(RELOAD_SCRIPT)
    if (action === EMenuAction.ToggleDevTools) win.webview.toggleDevTools()
  })

  Electrobun.events.on('before-quit', () => {
    webUpdater.stop()
    void host.stop()
    void appServer.stop()
  })
}

await runLogged({ start: startApp, notify: showStartupFailure })
