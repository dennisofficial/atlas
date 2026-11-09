import { describe, expect, test } from 'bun:test'
import { existsSync, lstatSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { symlinksUnder } from '../../../scripts/flatten-web-deps'
import { bunPath, startNextServer } from '../next-server'

const bundle = resolve(import.meta.dir, '../../../web-standalone')
const root = join(bundle, 'apps', 'web')
const built = existsSync(join(root, 'server.js'))

describe.skipIf(!built)('built app server', () => {
  test('ships the web bundle as real files, not links out of the app', () => {
    const next = join(root, 'node_modules', 'next')
    expect(lstatSync(next).isSymbolicLink()).toBe(false)
    expect(statSync(join(next, 'dist', 'server', 'lib', 'start-server.js')).isFile()).toBe(true)
    expect(symlinksUnder(bundle)).toEqual([])
  })

  test('answers a dynamic route and its flight request', async () => {
    const server = await startNextServer({ root, bunPath: bunPath() })
    try {
      const document = await fetch(`${server.origin}/threads/built-app-probe`)
      expect({ status: document.status, html: document.headers.get('content-type') }).toEqual({
        status: 200,
        html: 'text/html; charset=utf-8',
      })

      const flight = await fetch(`${server.origin}/threads/built-app-probe?_rsc=probe`, {
        headers: { RSC: '1' },
      })
      expect({ status: flight.status, type: flight.headers.get('content-type') }).toEqual({
        status: 200,
        type: 'text/x-component',
      })
    } finally {
      await server.stop()
    }
  }, 60_000)
})
