import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { flattenPackageLinks, packageNameOf, symlinksUnder } from '../flatten-web-deps'

function file(path: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '')
}

function storeDir(root: string, at: string): string {
  return join(root, 'node_modules', '.bun', at, 'node_modules')
}

describe('packageNameOf', () => {
  test('keeps the scope of a scoped package', () => {
    expect(packageNameOf('/store/.bun/next@16/node_modules/next')).toBe('next')
    expect(packageNameOf('/store/.bun/@swc+helpers@0.5/node_modules/@swc/helpers')).toBe(
      join('@swc', 'helpers'),
    )
  })
})

describe('flattenPackageLinks', () => {
  test('replaces a link with real directories, dependencies included', () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-flatten-'))
    file(join(storeDir(root, 'next@16.3.5'), 'next', 'dist', 'start-server.js'))
    const helpersStore = storeDir(root, '@swc+helpers@0.5.15')
    file(join(helpersStore, '@swc', 'helpers', 'runtime.js'))
    mkdirSync(join(storeDir(root, 'next@16.3.5'), '@swc'), { recursive: true })
    symlinkSync(
      join(helpersStore, '@swc', 'helpers'),
      join(storeDir(root, 'next@16.3.5'), '@swc', 'helpers'),
    )

    const nodeModules = join(root, 'apps', 'web', 'node_modules')
    mkdirSync(nodeModules, { recursive: true })
    symlinkSync(join(storeDir(root, 'next@16.3.5'), 'next'), join(nodeModules, 'next'))

    const written = flattenPackageLinks({ nodeModules })

    expect(written).toEqual(['next', join('@swc', 'helpers')])
    expect(existsSync(join(nodeModules, 'next', 'dist', 'start-server.js'))).toBe(true)
    expect(existsSync(join(nodeModules, '@swc', 'helpers', 'runtime.js'))).toBe(true)
    expect(symlinksUnder(nodeModules)).toEqual([])
  })
})
