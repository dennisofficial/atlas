import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { canLinkPath, resetPathLinkVerdicts } from '../path-links'

let sandbox = ''

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'path-links-'))
  resetPathLinkVerdicts()
})

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true })
  resetPathLinkVerdicts()
})

describe('canLinkPath', () => {
  it('refuses a slash-joined phrase that names nothing on disk', () => {
    expect(canLinkPath('lift/descend')).toBeNull()
    expect(canLinkPath('restart/location-resolution')).toBeNull()
  })

  it('links a relative path that exists under the process cwd, resolved absolute', () => {
    expect(canLinkPath('package.json')).toBe('package.json')
    expect(canLinkPath('src/ui')).toBe(resolve('src/ui'))
  })

  it('links an absolute path that exists and refuses one that does not', () => {
    const real = join(sandbox, 'a.ts')
    writeFileSync(real, '')
    expect(canLinkPath(real)).toBe(real)
    expect(canLinkPath(join(sandbox, 'missing.ts'))).toBeNull()
  })

  it('expands ~ to the home directory before checking', () => {
    expect(canLinkPath('~/.definitely-not-here-path-links-spec')).toBeNull()
  })

  it('links a bare filename with a known extension without touching the disk', () => {
    expect(canLinkPath('package.json')).toBe('package.json')
    expect(canLinkPath('link-click.ts')).toBe('link-click.ts')
  })

  it('refuses a bare word with no extension and no slash', () => {
    expect(canLinkPath('descend')).toBeNull()
  })

  it('caches the verdict by candidate text', () => {
    const real = join(sandbox, 'cached.ts')
    writeFileSync(real, '')
    expect(canLinkPath(real)).toBe(real)
    rmSync(real)
    expect(canLinkPath(real)).toBe(real)

    const gone = 'still/not/here'
    expect(canLinkPath(gone)).toBeNull()
    resetPathLinkVerdicts()
    expect(canLinkPath(gone)).toBeNull()
  })
})
