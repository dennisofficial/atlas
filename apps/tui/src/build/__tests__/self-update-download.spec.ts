import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { downloadReleaseAssets } from '../self-update'

const BINARY = 'a fresh atlas binary'
const SIDECAR = 'deadbeef  atlas-darwin-arm64\n'

describe('downloadReleaseAssets', () => {
  let server: ReturnType<typeof Bun.serve>
  let baseUrl: string
  let dir: string

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname
        if (path === '/tui-v0.7.0/atlas-darwin-arm64') return new Response(BINARY)
        if (path === '/tui-v0.7.0/atlas-darwin-arm64.sha256') return new Response(SIDECAR)
        return new Response('not found', { status: 404 })
      },
    })
    baseUrl = `http://127.0.0.1:${server.port}`
    dir = await mkdtemp(join(tmpdir(), 'atlas-download-spec-'))
  })

  afterAll(async () => {
    server.stop(true)
    await rm(dir, { recursive: true, force: true })
  })

  it('writes the binary and its sha256 sidecar into the target dir', async () => {
    const ok = await downloadReleaseAssets({
      baseUrl,
      tag: 'tui-v0.7.0',
      asset: 'atlas-darwin-arm64',
      dir,
    })

    expect(ok).toBe(true)
    expect(await readFile(join(dir, 'atlas-darwin-arm64'), 'utf8')).toBe(BINARY)
    expect(await readFile(join(dir, 'atlas-darwin-arm64.sha256'), 'utf8')).toBe(SIDECAR)
  })

  it('fails without writing the sidecar when the binary is not there', async () => {
    const ok = await downloadReleaseAssets({
      baseUrl,
      tag: 'tui-v9.9.9',
      asset: 'atlas-darwin-arm64',
      dir,
    })

    expect(ok).toBe(false)
    expect(await readFile(join(dir, 'atlas-darwin-arm64.sha256'), 'utf8')).toBe(SIDECAR)
  })
})
