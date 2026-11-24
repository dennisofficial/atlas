import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { subpathViolations } from '../../review/__tests__/subpath-walker'

const ALLOWED = ['@dltech/atlas-core']

describe('quality core entry purity guard', () => {
  it('reaches nothing but the shared types', () => {
    const root = join(import.meta.dir, '..', '..')
    const entry = join(root, 'core', 'index.ts')
    expect(subpathViolations({ entry, root, allowedPackages: ALLOWED })).toEqual([])
  })
})
