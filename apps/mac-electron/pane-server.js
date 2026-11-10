import { createServer } from 'node:http'

import { parsePaneCommand } from './pane-command.js'

export const PANE_PATHS = new Set(['/pane', '/desktop/pane'])

const BODY_LIMIT_BYTES = 1_000_000

async function readBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > BODY_LIMIT_BYTES) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function reply({ response, status, body }) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

export function createPaneRequestHandler({ apply }) {
  return async ({ request, response }) => {
    const { pathname } = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (!PANE_PATHS.has(pathname)) return reply({ response, status: 404, body: 'Not Found' })
    if (request.method !== 'POST')
      return reply({ response, status: 405, body: { ok: false, error: 'method not allowed' } })

    const body = await readBody(request)
    let parsed = null
    try {
      parsed = body === null ? null : JSON.parse(body)
    } catch {
      parsed = null
    }
    if (body === null || parsed === null)
      return reply({ response, status: 400, body: { ok: false, error: 'invalid command' } })

    const command = parsePaneCommand(parsed)
    if (command === null)
      return reply({ response, status: 400, body: { ok: false, error: 'invalid command' } })

    try {
      const result = await apply(command)
      return reply({
        response,
        status: 200,
        body: result.ok === true ? { ok: true } : { ok: false, error: String(result.error) },
      })
    } catch (error) {
      return reply({ response, status: 200, body: { ok: false, error: String(error.message) } })
    }
  }
}

export async function startPaneServer({ apply, port = 0 }) {
  const handle = createPaneRequestHandler({ apply })
  const server = createServer((request, response) => {
    void handle({ request, response })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  const bound = server.address().port
  return {
    origin: `http://127.0.0.1:${bound}`,
    port: bound,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
