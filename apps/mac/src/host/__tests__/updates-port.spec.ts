import { afterEach, describe, expect, test } from 'bun:test'

import { createUpdatesPort, parseUpdateStatus } from '../updates-port'
import { EDesktopUpdateState } from '../update-routes'
import { EWebPayloadState } from '../web-payload/updater'

let server: ReturnType<typeof Bun.serve> | undefined

afterEach(() => {
  server?.stop(true)
  server = undefined
})

const serving = (answer: (request: Request) => Response | Promise<Response>) => {
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: answer })
  return `http://127.0.0.1:${server.port}`
}

const READY = {
  state: EDesktopUpdateState.Ready,
  version: '1.320.0',
  web: { state: EWebPayloadState.Ready, version: '1.320.1', hash: 'abc123' },
}

describe('parseUpdateStatus', () => {
  test('keeps the fields the web card reads and drops anything else', () => {
    expect(parseUpdateStatus({ input: { ...READY, extra: 'ignored' } })).toEqual(READY)
  })

  test('refuses a status the routes cannot serve', () => {
    expect(() => parseUpdateStatus({ input: { state: 'downloading' } })).toThrow()
  })
})

describe('createUpdatesPort', () => {
  test('reads the status the shell holds', async () => {
    const origin = serving(() => Response.json(READY))

    expect(await createUpdatesPort({ origin }).status()).toEqual(READY)
  })

  test('asks the shell to check and restarts through it', async () => {
    const paths: string[] = []
    const origin = serving((request) => {
      const pathname = new URL(request.url).pathname
      paths.push(`${request.method} ${pathname}`)
      return Response.json(READY)
    })
    const port = createUpdatesPort({ origin })

    expect(await port.check()).toEqual(READY)
    await port.restart()

    expect(paths).toEqual(['POST /update/check', 'POST /update/restart'])
  })

  test('throws rather than reporting a status the shell never gave', async () => {
    const origin = serving(() => new Response('nope', { status: 500 }))

    await expect(createUpdatesPort({ origin }).status()).rejects.toThrow()
    await expect(createUpdatesPort({ origin }).restart()).rejects.toThrow()
  })

  test('throws when the shell answers something that is not a status', async () => {
    const origin = serving(() => Response.json({ ready: true }))

    await expect(createUpdatesPort({ origin }).check()).rejects.toThrow()
  })
})
