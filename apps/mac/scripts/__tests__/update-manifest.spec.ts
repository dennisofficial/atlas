import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { latestManifest, zipNameOf } from '../update-manifest'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-update-manifest-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const RELEASED_AT = '2026-11-11T18:13:21.000Z'

describe('zipNameOf', () => {
  test('names the one archive the build produced', () => {
    writeFileSync(join(dir, 'Atlas-1.320.0-arm64-mac.zip'), 'zip')

    expect(zipNameOf({ dir })).toBe('Atlas-1.320.0-arm64-mac.zip')
  })

  test('refuses to guess when the release has no archive or more than one', () => {
    expect(() => zipNameOf({ dir })).toThrow()
    writeFileSync(join(dir, 'a.zip'), 'zip')
    writeFileSync(join(dir, 'b.zip'), 'zip')
    expect(() => zipNameOf({ dir })).toThrow()
  })
})

describe('latestManifest', () => {
  const bytes = new Uint8Array([1, 2, 3, 4])
  const sha512 = createHash('sha512').update(bytes).digest('base64')

  test('names the zip and the digest Squirrel checks it against', () => {
    const parsed = Bun.YAML.parse(
      latestManifest({
        version: '1.320.0',
        zipName: 'Atlas-1.320.0-arm64-mac.zip',
        bytes,
        releasedAt: RELEASED_AT,
      }),
    )

    expect(parsed).toEqual({
      version: '1.320.0',
      files: [{ url: 'Atlas-1.320.0-arm64-mac.zip', sha512, size: 4 }],
      path: 'Atlas-1.320.0-arm64-mac.zip',
      sha512,
      releaseDate: RELEASED_AT,
    })
  })

  test('reads back as the file the feed serves', () => {
    const text = latestManifest({
      version: '1.320.0',
      zipName: 'Atlas-1.320.0-arm64-mac.zip',
      bytes,
      releasedAt: RELEASED_AT,
    })
    writeFileSync(join(dir, 'latest-mac.yml'), text)

    expect(readFileSync(join(dir, 'latest-mac.yml'), 'utf8')).toBe(text)
    expect(text.endsWith('\n')).toBe(true)
  })
})
