import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDesktopHost } from '../index'

describe('desktop host port', () => {
  test('binds the same origin again after a restart so the web storage survives', async () => {
    const home = mkdtempSync(join(tmpdir(), 'atlas-host-port-'))
    const options = { appOrigin: 'http://127.0.0.1:1', secret: 's', stablePortHome: home }
    const first = createDesktopHost(options)
    await first.stop()
    const second = createDesktopHost(options)
    await second.stop()
    expect(second.url).toBe(first.url)
  })
})
