import { spawn } from 'node:child_process'
import { createServer } from 'node:http'

import { app, BrowserWindow, WebContentsView } from 'electron'

import {
  hostEnvironment,
  resolveBun,
  resolveHostScript,
  sessionUrlIn,
  webRootAt,
} from './host-paths.js'

const START_TIMEOUT_MS = 20_000
const PANE_PATH = '/pane'
const DESKTOP_PANE_PATH = '/desktop/pane'
const PANE_URL = 'https://google.com'
const PANE_PARTITION = 'persist:spike'
const WINDOW_WIDTH = 1280
const WINDOW_HEIGHT = 820
const PANE_SHARE = 0.5
const OUTPUT_LIMIT = 8_000

function paneBounds({ width, height }) {
  const paneWidth = Math.round(width * PANE_SHARE)
  return { x: width - paneWidth, y: 0, width: paneWidth, height }
}

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

function startHost({ script, bun, environment }) {
  const child = spawn(bun, [script], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  let settled = false
  const url = new Promise((resolve, reject) => {
    const fail = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      fail(
        new Error(
          `the desktop host did not report a session URL within ${START_TIMEOUT_MS}ms\n${output}`,
        ),
      )
    }, START_TIMEOUT_MS)
    const collect = (chunk) => {
      output = (output + chunk.toString()).slice(-OUTPUT_LIMIT)
      const found = sessionUrlIn(output)
      if (found === undefined || settled) return
      settled = true
      clearTimeout(timer)
      resolve(found)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('error', (error) => fail(error))
    child.on('exit', (code) => fail(new Error(`the desktop host exited with ${code}\n${output}`)))
  })
  return { child, url, output: () => output }
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
  })

  const pane = new WebContentsView({
    webPreferences: { partition: PANE_PARTITION, contextIsolation: true },
  })
  win.contentView.addChildView(pane)

  const layoutPane = () => {
    const [width, height] = win.getContentSize()
    pane.setBounds(paneBounds({ width, height }))
  }

  win.on('resize', layoutPane)

  layoutPane()
  pane.webContents.loadURL(PANE_URL)

  const session = await startPaneServer({ pane })
  const host = startHost({
    script: resolveHostScript({
      env: process.env,
      resourcesPath: process.resourcesPath,
      appRoot: app.getAppPath(),
    }),
    bun: resolveBun({ env: process.env, resourcesPath: process.resourcesPath }),
    environment: hostEnvironment({
      base: process.env,
      paneOrigin: session.origin,
      webRoot: webRootAt({ resourcesPath: process.resourcesPath }),
    }),
  })

  win.on('closed', () => {
    host.child.kill('SIGTERM')
    session.server.close()
    pane.webContents.close()
  })

  try {
    await win.loadURL(await host.url)
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
