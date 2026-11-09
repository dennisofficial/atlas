import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { createDesktopHost, type IDesktopHost } from '../index'

const SECRET = 'c'.repeat(64)
const cleared: number[] = []
let app: ReturnType<typeof Bun.serve>
let host: IDesktopHost

beforeAll(() => {
  app = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    idleTimeout: 0,
    fetch: () =>
      new Response('<!doctype html><title>atlas</title>', {
        headers: { 'content-type': 'text/html' },
      }),
  })
  host = createDesktopHost({
    appOrigin: `http://127.0.0.1:${app.port}`,
    apiOrigin: 'http://127.0.0.1:1',
    secret: SECRET,
    previewViews: { clear: () => cleared.push(1) },
  })
})

afterAll(async () => {
  await host.stop()
  await app.stop(true)
})

describe('preview views across a document load', () => {
  test('clears the previous document views, which a reload cannot tear down itself', async () => {
    await fetch(`${host.url}/`, { headers: { 'sec-fetch-dest': 'document' } })

    expect(cleared).toHaveLength(1)
  })

  test('leaves them alone for a subresource', async () => {
    const before = cleared.length

    await fetch(`${host.url}/`, { headers: { 'sec-fetch-dest': 'script' } })

    expect(cleared).toHaveLength(before)
  })
})
