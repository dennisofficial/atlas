import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDesktopHost, type IDesktopHost } from '../index'

const SECRET = 'c'.repeat(64)
const cleared: number[] = []
let host: IDesktopHost
let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'atlas-preview-views-'))
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>atlas</title>')
  host = createDesktopHost({
    webRoot: root,
    apiOrigin: 'http://127.0.0.1:1',
    secret: SECRET,
    previewViews: { clear: () => cleared.push(1) },
  })
})

afterAll(async () => {
  await host.stop()
  rmSync(root, { recursive: true, force: true })
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
