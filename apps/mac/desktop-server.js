import { createServer } from 'node:http'

import { validCommand } from './panes.js'
import { answerUpdate } from './updates.js'

const PANE_PATH = '/pane'
const DESKTOP_PANE_PATH = '/desktop/pane'

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

export async function startDesktopServer({ panes, updates }) {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const answered = answerUpdate({ updates, request, pathname })
    if (answered !== undefined) {
      answered.then(
        ({ status, body }) => {
          if (body === null) {
            response.writeHead(status, { 'content-length': 0 })
            response.end()
            return
          }
          respond(response, status, body)
        },
        (error) => respond(response, 500, { ok: false, error: String(error) }),
      )
      return
    }
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

export function errorPage(error) {
  const message = error instanceof Error ? error.message : String(error)
  const html = `<!doctype html><meta charset="utf-8"><title>Atlas could not start</title>
<body style="font: 15px -apple-system, system-ui; padding: 40px; color: #111">
<h1 style="font-size: 20px">Atlas could not start</h1>
<pre style="white-space: pre-wrap; color: #555">${message.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</pre>
</body>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
