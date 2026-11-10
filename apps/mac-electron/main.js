import { createServer } from 'node:http'
import { join } from 'node:path'

import { app, BrowserWindow, WebContentsView } from 'electron'

import { hostEnvironment, resolveBun, resolveHostScript, webRootAt } from './host-paths.js'
import { startHost } from './host-process.js'
import {
  createElectronWebUpdater,
  manifestUrlOf,
  payloadHomeOf,
  payloadWebRoot,
  webRootFor,
} from './web-payload.js'

const PANE_PATH = '/pane'
const DESKTOP_PANE_PATH = '/desktop/pane'
const PANE_PARTITION = 'persist:spike'
const WINDOW_WIDTH = 1280
const WINDOW_HEIGHT = 820
const OUTPUT_LIMIT = 8_000

function validRect(rect) {
  return (
    typeof rect === 'object' &&
    rect !== null &&
    ['x', 'y', 'width', 'height'].every((key) => typeof rect[key] === 'number')
  )
}

function validCommand(command) {
  if (typeof command !== 'object' || command === null) return false
  switch (command.kind) {
    case 'show':
      return typeof command.url === 'string' && validRect(command.rect)
    case 'hide':
    case 'back':
    case 'forward':
    case 'reload':
    case 'stop':
      return true
    case 'setRect':
      return validRect(command.rect)
    case 'navigate':
      return typeof command.url === 'string'
    case 'setObscured':
      return typeof command.obscured === 'boolean'
    default:
      return false
  }
}

function applyPaneCommand(pane, command) {
  switch (command.kind) {
    case 'show':
      pane.setVisible(true)
      pane.setBounds(command.rect)
      void pane.webContents.loadURL(command.url)
      break
    case 'hide':
      pane.setVisible(false)
      break
    case 'setRect':
      pane.setBounds(command.rect)
      break
    case 'navigate':
      void pane.webContents.loadURL(command.url)
      break
    case 'back':
      pane.webContents.navigationHistory.goBack()
      break
    case 'forward':
      pane.webContents.navigationHistory.goForward()
      break
    case 'reload':
      pane.webContents.reload()
      break
    case 'stop':
      pane.webContents.stop()
      break
    case 'setObscured':
      pane.setVisible(!command.obscured)
      break
  }
}

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

async function startPaneServer({ pane }) {
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
        applyPaneCommand(pane, command)
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

  const pane = new WebContentsView({
    webPreferences: { partition: PANE_PARTITION, contextIsolation: true },
  })
  win.contentView.addChildView(pane)
  pane.setVisible(false)

  const session = await startPaneServer({ pane })
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
      environment: hostEnvironment({ base: process.env, paneOrigin: session.origin, webRoot }),
    })

  let host
  win.on('closed', () => {
    payloads.stop()
    host?.child.kill('SIGTERM')
    session.server.close()
    pane.webContents.close()
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
