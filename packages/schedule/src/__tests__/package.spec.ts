import { describe, expect, it } from 'bun:test'

import manifest from '../../package.json'

describe('@dltech/atlas-schedule has no runtime dependencies', () => {
  it('declares the package name and an export map', () => {
    expect(manifest.name).toBe('@dltech/atlas-schedule')
    expect(manifest.exports).toEqual({ '.': './src/index.ts' })
  })

  it('declares no dependencies', () => {
    expect(manifest.dependencies).toEqual({})
  })
})
