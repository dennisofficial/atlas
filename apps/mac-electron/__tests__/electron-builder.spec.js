import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

const appRoot = join(import.meta.dir, '..')
const config = Bun.YAML.parse(readFileSync(join(appRoot, 'electron-builder.yml'), 'utf8'))
const entitlements = readFileSync(join(appRoot, 'build', 'entitlements.mac.plist'), 'utf8')

const REQUIRED = [
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.disable-library-validation',
  'com.apple.security.cs.allow-dyld-environment-variables',
  'com.apple.security.network.client',
  'com.apple.security.network.server',
]

describe('the release build', () => {
  test('is the app Store-less users install, not the spike', () => {
    expect(config.productName).toBe('Atlas')
    expect(config.appId).toBe('io.byatlas.mac')
  })

  test('signs with the identity from the keychain rather than skipping signing', () => {
    expect(config.mac.identity).toBeUndefined()
    expect(config.mac.hardenedRuntime).toBe(true)
  })

  test('signs the bun runtime the app spawns, with the same entitlements', () => {
    expect(config.mac.binaries).toContain('Contents/Resources/bin/bun')
    expect(config.mac.entitlementsInherit).toBe(config.mac.entitlements)
  })

  test('leaves the web tree bun serves out of signing', () => {
    expect(config.mac.signIgnore.join(' ')).toContain('/web-standalone/')
  })

  test('notarizes', () => {
    expect(config.mac.notarize).toBe(true)
  })

  test('names the asset after the version it was built from', () => {
    expect(config.dmg.artifactName).toBe('Atlas-${version}-mac-arm64.dmg')
    expect(config.dmg.title).toBe('Atlas ${version}')
  })

  test('grants what Chromium and the spawned runtime need', () => {
    for (const key of REQUIRED) expect(entitlements).toContain(`<key>${key}</key>`)
  })
})
