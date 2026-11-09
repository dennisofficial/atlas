import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseManifest } from '../../src/host/web-payload/manifest'
import { packWebPayload } from '../pack-web-payload'

function standalone() {
  const work = mkdtempSync(join(tmpdir(), 'pack-web-'))
  const root = join(work, 'web-standalone')
  mkdirSync(join(root, 'apps', 'web'), { recursive: true })
  writeFileSync(join(root, 'apps', 'web', 'server.js'), 'console.log(1)')
  return { work, root }
}

describe('packWebPayload', () => {
  test('writes an artifact and a manifest that describes it', () => {
    const { work, root } = standalone()
    const packed = packWebPayload({
      root,
      outDir: join(work, 'out'),
      builtAt: '2026-11-09T00:00:00.000Z',
    })
    const manifest = parseManifest({
      input: JSON.parse(readFileSync(packed.manifestPath, 'utf8')),
    })
    expect(manifest?.hash).toBe(packed.hash)
    expect(manifest?.artifact).toBe(`web-${packed.hash}.tar.gz`)
    expect(manifest?.size).toBe(readFileSync(packed.artifactPath).byteLength)
    expect(manifest?.builtAt).toBe('2026-11-09T00:00:00.000Z')
    expect(manifest?.requiresShell).toBeGreaterThan(0)
  })

  test('refuses a directory that is not a web standalone build', () => {
    const work = mkdtempSync(join(tmpdir(), 'pack-web-'))
    expect(() => packWebPayload({ root: work, outDir: join(work, 'out') })).toThrow(
      'apps/web/server.js is missing',
    )
  })

  test('archives the payload contents so extraction yields apps/web/server.js', () => {
    const { work, root } = standalone()
    const packed = packWebPayload({ root, outDir: join(work, 'out') })
    const listing = Bun.spawnSync({ cmd: ['tar', '-tzf', packed.artifactPath] }).stdout.toString()
    expect(listing).toContain('apps/web/server.js')
  })
})
