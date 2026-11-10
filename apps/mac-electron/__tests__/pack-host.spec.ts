import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { bunBinaryPathOf, hostBuildArgs, standaloneIsBuilt } from '../scripts/pack-host'

let root

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'atlas-pack-host-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('hostBuildArgs', () => {
  test('builds the desktop host entry for bun', () => {
    expect(
      hostBuildArgs({ entry: '/repo/apps/mac/src/desktop-host/index.ts', outdir: '/dist' }),
    ).toEqual([
      'build',
      '/repo/apps/mac/src/desktop-host/index.ts',
      '--target=bun',
      '--outdir=/dist',
    ])
  })
})

describe('bunBinaryPathOf', () => {
  test('prefers bun on PATH', () => {
    expect(bunBinaryPathOf({ onPath: '/opt/bun', execPath: '/usr/bin/node' })).toBe('/opt/bun')
  })

  test('takes the running bun when PATH has none', () => {
    expect(
      bunBinaryPathOf({ onPath: null, execPath: '/opt/mise/installs/bun/1.4.2/bin/bun' }),
    ).toBe('/opt/mise/installs/bun/1.4.2/bin/bun')
  })

  test('fails when neither is a bun runtime', () => {
    expect(() => bunBinaryPathOf({ onPath: null, execPath: '/usr/bin/node' })).toThrow(
      'no bun executable to ship',
    )
  })
})

describe('standaloneIsBuilt', () => {
  test('needs the standalone server entry', () => {
    expect(standaloneIsBuilt({ root })).toBe(false)
    mkdirSync(join(root, 'apps', 'web'), { recursive: true })
    writeFileSync(join(root, 'apps', 'web', 'server.js'), '')
    expect(standaloneIsBuilt({ root })).toBe(true)
  })
})
