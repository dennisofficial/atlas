import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { subpathViolations } from './subpath-walker'

const ALLOWED = ['@dltech/atlas-core', 'typescript', 'node:path', 'node:crypto']

describe('quality purity guard', () => {
  it('reaches nothing but core, typescript and the two node builtins from @dltech/atlas-quality', () => {
    const entry = join(import.meta.dir, '..', 'index.ts')
    expect(subpathViolations({ entry, allowedPackages: ALLOWED })).toEqual([])
  })
})
