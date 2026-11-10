import { describe, expect, test } from 'bun:test'

import { startPaneServer } from '../pane-server'

const rect = { x: 640, y: 0, width: 640, height: 820 }

async function withServer(seen) {
  const server = await startPaneServer({
    apply: (command) => {
      seen.push(command)
      return { ok: true }
    },
  })
  return server
}

const post = ({ origin, path, body, method = 'POST' }) =>
  fetch(`${origin}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

describe('pane server', () => {
  test('accepts the command on both paths the host may post to', async () => {
    const seen = []
    const server = await withServer(seen)
    try {
      for (const path of ['/pane', '/desktop/pane']) {
        const response = await post({
          origin: server.origin,
          path,
          body: { kind: 'show', url: 'https://x.test', rect },
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
      }
      expect(seen).toEqual([
        { kind: 'show', url: 'https://x.test', rect },
        { kind: 'show', url: 'https://x.test', rect },
      ])
    } finally {
      await server.close()
    }
  })

  test('answers a rejected command with the error', async () => {
    const server = await startPaneServer({ apply: () => ({ ok: false, error: 'no window' }) })
    try {
      const response = await post({ origin: server.origin, path: '/pane', body: { kind: 'hide' } })
      expect(await response.json()).toEqual({ ok: false, error: 'no window' })
    } finally {
      await server.close()
    }
  })

  test('rejects a body that is not a pane command', async () => {
    const seen = []
    const server = await withServer(seen)
    try {
      const unknown = await post({
        origin: server.origin,
        path: '/pane',
        body: { kind: 'explode' },
      })
      expect(unknown.status).toBe(400)
      expect(await unknown.json()).toEqual({ ok: false, error: 'invalid command' })

      const garbage = await fetch(`${server.origin}/pane`, { method: 'POST', body: 'not json' })
      expect(garbage.status).toBe(400)
      expect(seen).toEqual([])
    } finally {
      await server.close()
    }
  })

  test('answers 404 off the pane paths and 405 off POST', async () => {
    const server = await withServer([])
    try {
      const elsewhere = await post({ origin: server.origin, path: '/desktop/other', body: {} })
      expect(elsewhere.status).toBe(404)
      const wrongMethod = await post({ origin: server.origin, path: '/pane', method: 'GET' })
      expect(wrongMethod.status).toBe(405)
    } finally {
      await server.close()
    }
  })

  test('turns a thrown handler error into a reply', async () => {
    const server = await startPaneServer({
      apply: () => {
        throw new Error('view is gone')
      },
    })
    try {
      const response = await post({
        origin: server.origin,
        path: '/desktop/pane',
        body: { kind: 'reload' },
      })
      expect(await response.json()).toEqual({ ok: false, error: 'view is gone' })
    } finally {
      await server.close()
    }
  })
})
