import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { subpathViolations } from './subpath-walker'

const ALLOWED = [
  '@dltech/atlas-agent',
  '@dltech/atlas-core',
  '@dltech/atlas-plugin-sdk',
  'typescript',
  'node:path',
  'node:crypto',
]

describe('quality purity guard', () => {
  it('reaches nothing but the harness, the plugin sdk, typescript and two node builtins', () => {
    const root = join(import.meta.dir, '..', '..')
    const entry = join(root, 'pod', 'index.ts')
    expect(subpathViolations({ entry, root, allowedPackages: ALLOWED })).toEqual([])
  })
})
