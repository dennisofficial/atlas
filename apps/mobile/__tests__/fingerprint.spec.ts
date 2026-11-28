import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'bun:test'

import fingerprintConfig from '../fingerprint.config.js'

const appRoot = resolve(import.meta.dir, '..')
const repoRoot = resolve(appRoot, '../..')

describe('native build fingerprint', () => {
  it('hashes the patched dependencies, so a native patch forces a native build', () => {
    const rootManifest = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
    const patchDirs = Object.values<string>(rootManifest.patchedDependencies ?? {}).map((path) =>
      resolve(repoRoot, path, '..'),
    )
    const hashedDirs = fingerprintConfig.extraSources
      .filter((source: { type: string }) => source.type === 'dir')
      .map((source: { filePath: string }) => resolve(appRoot, source.filePath))
    for (const dir of patchDirs) expect(hashedDirs).toContain(dir)
  })

  it('runs the production workflow when a patch changes', () => {
    const workflow = readFileSync(resolve(appRoot, '.eas/workflows/production.yml'), 'utf8')
    expect(workflow).toContain("- 'patches/**'")
  })
})
