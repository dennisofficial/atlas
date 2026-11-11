import { createServer } from 'node:http'
import { join } from 'node:path'

import { app, BrowserWindow, ipcMain, WebContentsView, shell } from 'electron'

import { hostEnvironment, resolveBun, resolveHostScript, webRootAt } from './host-paths.js'
import { externalUrlOf, sameOrigin } from './links.js'
import { startHost } from './host-process.js'
import { createPaneRegistry, validCommand } from './panes.js'
import {
  createElectronWebUpdater,
  manifestUrlOf,
  payloadHomeOf,
  payloadWebRoot,
  webRootFor,
} from './web-payload.js'

const FULLSCREEN_STATE = 'atlas-desktop:fullscreen'
const FULLSCREEN_QUERY = 'atlas-desktop:is-fullscreen'
const PANE_PATH = '/pane'
const DESKTOP_PANE_PATH = '/desktop/pane'
const PANE_PARTITION = 'persist:spike'
const WINDOW_WIDTH = 1280
const WINDOW_HEIGHT = 820

ipcMain.on(FULLSCREEN_QUERY, (event) => {
  event.returnValue = BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false
})

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function respond(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

async function startPaneServer({ panes }) {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (pathname !== PANE_PATH && pathname !== DESKTOP_PANE_PATH) {
      respond(response, 404, { ok: false, error: 'not found' })
      return
    }
    if (request.method !== 'POST') {
      respond(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    void readBody(request)
      .then((body) => {
        let command
        try {
          command = JSON.parse(body)
        } catch {
          respond(response, 400, { ok: false, error: 'invalid command' })
          return
        }
        if (!validCommand(command)) {
          respond(response, 400, { ok: false, error: 'invalid command' })
          return
        }
        panes.apply(command)
        respond(response, 200, { ok: true })
      })
      .catch((error) => respond(response, 500, { ok: false, error: String(error) }))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return { server, origin: `http://127.0.0.1:${server.address().port}` }
}

function errorPage(error) {
  const message = error instanceof Error ? error.message : String(error)
  const html = `<!doctype html><meta charset="utf-8"><title>Atlas could not start</title>
<body style="font: 15px -apple-system, system-ui; padding: 40px; color: #111">
<h1 style="font-size: 20px">Atlas could not start</h1>
<pre style="white-space: pre-wrap; color: #555">${message.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</pre>
</body>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

function openInBrowser(url) {
  const external = externalUrlOf(url)
  if (external !== null) void shell.openExternal(external)
}

function denyWindow(url) {
  openInBrowser(url)
  return { action: 'deny' }
}

async function createWindow() {
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
      win.contentView.addChildView(view)
      view.setVisible(false)
      return view
    },
    release: (view) => {
      if (!win.isDestroyed()) win.contentView.removeChildView(view)
      if (!view.webContents.isDestroyed()) view.webContents.close()
    },
  })

  const session = await startPaneServer({ panes })
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
  const startSession = (webRoot) =>
    startHost({
      script,
      bun,
      environment: hostEnvironment({
        base: process.env,
        paneOrigin: session.origin,
        webRoot,
        appVersion: app.getVersion(),
      }),
    })

  let host
  win.on('closed', () => {
    payloads.stop()
    host?.child.kill('SIGTERM')
    session.server.close()
    panes.destroy()
  })

  const swapTo = async ({ hash }) => {
    const next = startSession(payloadWebRoot({ home, hash }))
    try {
      const url = await next.url
      await win.loadURL(url)
      host?.child.kill('SIGTERM')
      host = next
      console.log(`[web-payload] swapped the interface to ${hash}`)
      return true
    } catch (error) {
      next.child.kill('SIGTERM')
      console.error('[web-payload] the new interface did not start; keeping this one', error)
      await payloads.updater.fail({ hash })
      return false
    }
  }

  try {
    const installedHash = await payloads.updater.installedRoot()
    try {
      host = startSession(webRootFor({ home, bundledRoot, installedHash }))
      await win.loadURL(await host.url)
    } catch (error) {
      if (installedHash === undefined) throw error
      console.error('[web-payload] the installed interface failed; using the bundled one', error)
      await payloads.updater.fail({ hash: installedHash })
      host = startSession(bundledRoot)
      await win.loadURL(await host.url)
    }
    payloads.start({ onPayload: swapTo })
  } catch (error) {
    await win.loadURL(errorPage(error))
  }

  return win
}

app.whenReady().then(async () => {
  await createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
