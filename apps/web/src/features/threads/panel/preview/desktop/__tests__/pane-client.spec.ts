import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'

import type { PaneCommand } from '../pane-command'
import { PANE_PATH, paneAvailable, resetPaneAvailability, sendPaneCommand } from '../pane-client'

const TARGET = 'pane:thread-1:tab-1'

type Call = { url: string; init: RequestInit | undefined }

const originalFetch = globalThis.fetch
const calls: Call[] = []

const replyWith = (status: number, body: unknown) => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}

const failWith = (failure: Error) => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    throw failure
  }) as typeof fetch
}

const tick = () => new Promise<void>((done) => setTimeout(done, 0))

const bodyOf = (call: Call | undefined): PaneCommand =>
  JSON.parse(String(call?.init?.body)) as PaneCommand

beforeEach(() => {
  calls.length = 0
  resetPaneAvailability()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  resetPaneAvailability()
})

afterAll(() => {
  globalThis.fetch = originalFetch
})

describe('paneAvailable', () => {
  it('is true only when the shell accepts the probe', async () => {
    replyWith(200, { ok: true })
    expect(await paneAvailable()).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(PANE_PATH)
    expect(calls[0]?.init?.method).toBe('POST')
    expect(bodyOf(calls[0])).toEqual({ kind: 'hide' })
  })

  it('is false when the host has no pane route', async () => {
    replyWith(404, { ok: false, error: 'not found' })
    expect(await paneAvailable()).toBe(false)
  })

  it('is false when the route rejects the command', async () => {
    replyWith(400, { ok: false, error: 'invalid command' })
    expect(await paneAvailable()).toBe(false)
  })

  it('is false when the shell refuses with a 200', async () => {
    replyWith(200, { ok: false, error: 'no window' })
    expect(await paneAvailable()).toBe(false)
  })

  it('is false when the reply is not json', async () => {
    globalThis.fetch = (async () =>
      new Response('Not Found', { status: 404 })) as unknown as typeof fetch
    expect(await paneAvailable()).toBe(false)
  })

  it('is false when the endpoint cannot be reached', async () => {
    failWith(new TypeError('Failed to fetch'))
    expect(await paneAvailable()).toBe(false)
  })

  it('probes once however often it is asked', async () => {
    replyWith(200, { ok: true })
    await Promise.all([paneAvailable(), paneAvailable()])
    await paneAvailable()
    expect(calls).toHaveLength(1)
  })
})

describe('sendPaneCommand', () => {
  it('carries the target id on the command', async () => {
    replyWith(200, { ok: true })
    expect(await sendPaneCommand({ id: TARGET, command: { kind: 'hide' } })).toBe(true)
    expect(bodyOf(calls[0])).toEqual({ kind: 'hide', id: TARGET })
  })

  it('posts the command the shell decodes', async () => {
    replyWith(200, { ok: true })
    const rect = { x: 12.5, y: 40.25, width: 700, height: 400 }
    expect(await sendPaneCommand({ id: TARGET, command: { kind: 'setRect', rect } })).toBe(true)
    expect(calls[0]?.url).toBe(PANE_PATH)
    expect(calls[0]?.init?.headers).toEqual({ 'content-type': 'application/json' })
    expect(bodyOf(calls[0])).toEqual({ kind: 'setRect', rect, id: TARGET })
  })

  it('delivers commands one at a time, in the order they were sent', async () => {
    const releases: Array<() => void> = []
    const release = () => {
      for (const done of releases.splice(0)) done()
    }
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      await new Promise<void>((done) => releases.push(done))
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as typeof fetch

    try {
      const first = sendPaneCommand({
        id: TARGET,
        command: {
          kind: 'show',
          url: 'https://example.com/',
          rect: { x: 0, y: 0, width: 1, height: 1 },
        },
      })
      const second = sendPaneCommand({ id: TARGET, command: { kind: 'hide' } })
      await tick()
      expect(calls.map((call) => bodyOf(call).kind)).toEqual(['show'])

      release()
      await first
      await tick()
      expect(calls.map((call) => bodyOf(call).kind)).toEqual(['show', 'hide'])

      release()
      await second
    } finally {
      release()
    }
  })

  it('reports a refused command rather than throwing', async () => {
    replyWith(400, { ok: false, error: 'invalid command' })
    expect(await sendPaneCommand({ id: TARGET, command: { kind: 'hide' } })).toBe(false)
  })
})
