import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { dropNativeWebDeps } from '../drop-native-web-deps'

function tree() {
  const root = mkdtempSync(join(tmpdir(), 'drop-native-'))
  for (const path of [
    join(root, 'node_modules', 'sharp'),
    join(root, 'node_modules', '@img', 'colour'),
    join(root, 'apps', 'web', 'node_modules', 'sharp'),
    join(root, 'apps', 'web', 'node_modules', 'next'),
  ])
    mkdirSync(path, { recursive: true })
  return root
}

describe('dropNativeWebDeps', () => {
  test('removes sharp and @img from every node_modules in the build', () => {
    const root = tree()
    const removed = dropNativeWebDeps({ root })
    expect(removed).toHaveLength(3)
    expect(existsSync(join(root, 'node_modules', 'sharp'))).toBe(false)
    expect(existsSync(join(root, 'node_modules', '@img'))).toBe(false)
    expect(existsSync(join(root, 'apps', 'web', 'node_modules', 'sharp'))).toBe(false)
  })

  test('leaves everything else in place', () => {
    const root = tree()
    dropNativeWebDeps({ root })
    expect(existsSync(join(root, 'apps', 'web', 'node_modules', 'next'))).toBe(true)
  })
})
