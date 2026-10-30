import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveStatic } from '../static'

const webRoot = resolve(import.meta.dir, '../../../../web/out')
const exportExists = existsSync(join(webRoot, 'index.html'))

describe.skipIf(!exportExists)('real export route parity', () => {
  test('every placeholder file resolves for a sample id', async () => {
    const entries = await readdir(webRoot, {
      recursive: true,
      withFileTypes: true,
    })
    const placeholders = entries
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).slice(webRoot.length + 1))
      .filter((path) => !path.startsWith('_next/'))
      .filter((path) =>
        path.split('/').some((segment) => segment === '_' || segment.startsWith('_.')),
      )
    expect(placeholders.length).toBeGreaterThan(0)
    for (const path of placeholders) {
      const pathname = `/${path
        .split('/')
        .map((s) => (s === '_' ? 'sample-id' : s.replace(/^_\./, 'sample-id.')))
        .join('/')}`
      const res = await serveStatic({ webRoot, pathname })
      expect({ pathname, status: res.status }).toEqual({
        pathname,
        status: 200,
      })
      const expected = await Bun.file(join(webRoot, path)).text()
      expect(await res.text()).toBe(expected)
    }
  })
})
