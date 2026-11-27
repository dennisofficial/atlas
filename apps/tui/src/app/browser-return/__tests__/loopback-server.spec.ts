import { describe, expect, it } from 'bun:test'

import { EReturnResult } from '@dltech/atlas-core'

import { type LoopbackCopy } from '../loopback-page'
import { startLoopbackReturn } from '../loopback-server'

const STATE = 'state-return-1'

const START_URL = `https://atlas.example/return/start/${STATE}`

const COPY: LoopbackCopy = {
  connected: 'Signed in to linear',
  failed: (reason) => `Could not sign in to linear: ${reason ?? 'no reason given'}`,
}

const opener = (): { urls: string[]; open: (url: string) => void } => {
  const urls: string[] = []
  return { urls, open: (url) => urls.push(url) }
}

const returnedUrl = (args: {
  port: number
  state?: string
  result?: string
  reason?: string
}): string => {
  const params = new URLSearchParams({
    atlasReturn: args.result ?? EReturnResult.Connected,
    atlasState: args.state ?? STATE,
  })
  if (args.reason !== undefined) params.set('atlasReason', args.reason)
  return `http://127.0.0.1:${args.port}/atlas-return?${params.toString()}`
}

const rawReplyOf = (args: { port: number; request: string }): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    void Bun.connect({
      hostname: '127.0.0.1',
      port: args.port,
      socket: {
        data: (_socket, data) => {
          chunks.push(data)
        },
        close: () => resolve(Buffer.concat(chunks).toString()),
        error: (_socket, error) => reject(error),
      },
    }).then((socket) => {
      socket.write(args.request)
    })
  })

describe('the loopback listener', () => {
  it('opens the start link for the tui on the port it bound', () => {
    const browser = opener()
    const handle = startLoopbackReturn({ url: START_URL, open: browser.open, copy: COPY })
    try {
      const opened = new URL(browser.urls[0] ?? '')
      expect(opened.pathname).toBe(`/return/start/${STATE}`)
      expect(opened.searchParams.get('surface')).toBe('tui')
      expect(opened.searchParams.get('port')).toBe(String(handle.port))
      expect(browser.urls[0]).toBe(handle.href)
    } finally {
      handle.stop()
    }
  })

  it('answers the browser, settles the outcome and stops once the state matches', async () => {
    const handle = startLoopbackReturn({ url: START_URL, open: opener().open, copy: COPY })

    const response = await fetch(returnedUrl({ port: handle.port }))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(await response.text()).toContain('Signed in to linear')
    expect(await handle.outcome).toEqual({ result: EReturnResult.Connected })
    await expect(fetch(returnedUrl({ port: handle.port }))).rejects.toBeDefined()
  })

  it('hands back the reason a refused sign-in carries', async () => {
    const handle = startLoopbackReturn({ url: START_URL, open: opener().open, copy: COPY })

    const response = await fetch(
      returnedUrl({
        port: handle.port,
        result: EReturnResult.Failed,
        reason: 'the provider refused',
      }),
    )

    expect(await response.text()).toContain('the provider refused')
    expect(await handle.outcome).toEqual({
      result: EReturnResult.Failed,
      reason: 'the provider refused',
    })
  })

  it('keeps waiting after a return for another state', async () => {
    const handle = startLoopbackReturn({ url: START_URL, open: opener().open, copy: COPY })

    const stranger = await fetch(returnedUrl({ port: handle.port, state: 'another-state' }))
    expect(stranger.status).toBe(404)

    const own = await fetch(returnedUrl({ port: handle.port }))
    expect(own.status).toBe(200)
    expect(await handle.outcome).toEqual({ result: EReturnResult.Connected })
  })

  it('refuses a return that names another host and keeps waiting for its own', async () => {
    const handle = startLoopbackReturn({ url: START_URL, open: opener().open, copy: COPY })

    const reply = await rawReplyOf({
      port: handle.port,
      request: `GET /atlas-return?atlasReturn=connected&atlasState=${STATE} HTTP/1.1\r\nHost: attacker.example:${handle.port}\r\nConnection: close\r\n\r\n`,
    })
    expect(reply).toContain('404')

    const own = await fetch(returnedUrl({ port: handle.port }))
    expect(own.status).toBe(200)
    expect(await handle.outcome).toEqual({ result: EReturnResult.Connected })
  })

  it('gives up after the timeout and closes the port', async () => {
    const handle = startLoopbackReturn({
      url: START_URL,
      open: opener().open,
      copy: COPY,
      timeoutMs: 20,
    })

    expect(await handle.outcome).toBeUndefined()
    await expect(fetch(returnedUrl({ port: handle.port }))).rejects.toBeDefined()
  })

  it('stops on demand without an outcome', async () => {
    const handle = startLoopbackReturn({ url: START_URL, open: opener().open, copy: COPY })

    handle.stop()

    expect(await handle.outcome).toBeUndefined()
    await expect(fetch(returnedUrl({ port: handle.port }))).rejects.toBeDefined()
  })
})
