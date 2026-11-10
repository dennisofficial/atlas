import { describe, expect, test } from 'bun:test'
import { createPaneHandler, PANE_PATH, type PaneCommand } from '../pane-routes'

const rect = { x: 0, y: 0, width: 640, height: 480 }

function handler(seen: PaneCommand[]) {
  return createPaneHandler({
    pane: {
      send: async (command) => {
        seen.push(command)
        return { ok: true as const }
      },
    },
  })
}

const post = (body: unknown): Request =>
  new Request(`http://127.0.0.1:1${PANE_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('pane route', () => {
  test('forwards a show command to the shell', async () => {
    const seen: PaneCommand[] = []
    const response = await handler(seen)(
      post({ kind: 'show', url: 'https://x.test', rect }),
      PANE_PATH,
    )
    expect(seen).toEqual([{ kind: 'show', url: 'https://x.test', rect }])
    expect(await response?.json()).toEqual({ ok: true })
  })

  test('rejects a command it does not know', async () => {
    const seen: PaneCommand[] = []
    const response = await handler(seen)(post({ kind: 'explode' }), PANE_PATH)
    expect(response?.status).toBe(400)
    expect(seen).toEqual([])
  })

  test('rejects a rect that is not numbers', async () => {
    const seen: PaneCommand[] = []
    const response = await handler(seen)(
      post({ kind: 'setRect', rect: { x: 'a', y: 0, width: 1, height: 1 } }),
      PANE_PATH,
    )
    expect(response?.status).toBe(400)
    expect(seen).toEqual([])
  })

  test('answers only POST on its own path', async () => {
    const seen: PaneCommand[] = []
    const get = new Request(`http://127.0.0.1:1${PANE_PATH}`)
    expect((await handler(seen)(get, PANE_PATH))?.status).toBe(405)
    expect(await handler(seen)(post({ kind: 'hide' }), '/desktop/other')).toBeUndefined()
    expect(seen).toEqual([])
  })
})
