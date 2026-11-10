import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  APP_BUNDLE_NAME,
  CHANNEL,
  ENTITLEMENTS,
  PLATFORM,
  PRODUCT_NAME,
  buildCreateDmgArgs,
  dmgArtifactNameFor,
  dmgNameFor,
  dmgSignTargets,
  readSigningEnv,
} from '../dmg-plan'

const appRoot = resolve(import.meta.dir, '..', '..')

const signedEnv = {
  ELECTROBUN_DEVELOPER_ID: 'Developer ID Application: X',
  ELECTROBUN_APPLEAPIKEYPATH: '/tmp/k.p8',
  ELECTROBUN_APPLEAPIKEY: 'KEYID',
  ELECTROBUN_APPLEAPIISSUER: 'ISSUER',
}

describe('readSigningEnv', () => {
  test('returns credentials when all present', () => {
    expect(readSigningEnv({ env: signedEnv })).toEqual({
      identity: 'Developer ID Application: X',
      apiKeyPath: '/tmp/k.p8',
      apiKeyId: 'KEYID',
      apiIssuer: 'ISSUER',
    })
  })
  test('skips under ATLAS_MAC_UNSIGNED=1', () => {
    expect(readSigningEnv({ env: { ...signedEnv, ATLAS_MAC_UNSIGNED: '1' } })).toBeNull()
  })
  test('skips when any credential is missing', () => {
    expect(
      readSigningEnv({ env: { ...signedEnv, ELECTROBUN_APPLEAPIISSUER: undefined } }),
    ).toBeNull()
  })
})

describe('buildCreateDmgArgs', () => {
  const args = buildCreateDmgArgs({
    appName: 'Atlas.app',
    volumeName: 'Atlas',
    volumeIcon: 'v.icns',
    background: 'b.tiff',
    outputPath: 'out.dmg',
    sourceDir: 'stage',
  })
  test('lays out app left and Applications right in a 660x400 window', () => {
    expect(args.join(' ')).toContain('--window-size 660 400')
    expect(args.join(' ')).toContain('--icon Atlas.app 180 200')
    expect(args.join(' ')).toContain('--app-drop-link 480 200')
  })
  test('ends with output then source', () => {
    expect(args.slice(-2)).toEqual(['out.dmg', 'stage'])
  })
})

describe('dmgNameFor', () => {
  test('drops the stable channel prefix', () => {
    expect(dmgNameFor({ channel: CHANNEL, platform: PLATFORM, productName: PRODUCT_NAME })).toBe(
      'macos-arm64-Atlas.dmg',
    )
  })
  test('keeps any other channel prefix', () => {
    expect(dmgNameFor({ channel: 'canary', platform: 'macos-x64', productName: 'Atlas' })).toBe(
      'canary-macos-x64-Atlas.dmg',
    )
  })
})

describe('dmgArtifactNameFor', () => {
  test('names the download after the version it carries', () => {
    expect(
      dmgArtifactNameFor({
        channel: CHANNEL,
        platform: PLATFORM,
        productName: PRODUCT_NAME,
        version: '1.286.0',
      }),
    ).toBe('macos-arm64-Atlas-1.286.0.dmg')
  })
  test('keeps the channel prefix and the arch it was built for', () => {
    expect(
      dmgArtifactNameFor({
        channel: 'canary',
        platform: 'macos-x64',
        productName: 'Atlas',
        version: '2.0.0',
      }),
    ).toBe('canary-macos-x64-Atlas-2.0.0.dmg')
  })
})

describe('dmgSignTargets', () => {
  const app = '/tmp/staging/Atlas.app'
  const targets = dmgSignTargets({ appPath: app })
  const paths = targets.map((target) => target.path)
  const framework = `${app}/Contents/Frameworks/Chromium Embedded Framework.framework`
  const helpers = paths.filter((path) => path.includes(' Helper'))
  const bun = `${app}/Contents/MacOS/bun`

  test('signs the framework first and the app last', () => {
    expect(paths[0]).toBe(framework)
    expect(paths.at(-1)).toBe(app)
  })
  test('signs all four Chromium helpers before the app', () => {
    expect(helpers).toHaveLength(4)
    expect(helpers).toContain(`${app}/Contents/Frameworks/AtlasShell Helper.app`)
    expect(helpers).toContain(`${app}/Contents/Frameworks/AtlasShell Helper (GPU).app`)
    expect(helpers).toContain(`${app}/Contents/Frameworks/AtlasShell Helper (Renderer).app`)
    expect(helpers).toContain(`${app}/Contents/Frameworks/AtlasShell Helper (Alerts).app`)
    for (const helper of helpers) expect(paths.indexOf(helper)).toBeLessThan(paths.indexOf(app))
  })
  test('signs the bundled Bun runtime before the app', () => {
    expect(paths).toContain(bun)
    expect(paths.indexOf(bun)).toBeLessThan(paths.indexOf(app))
  })
  test('deep-signs the helpers only', () => {
    expect(targets.filter((target) => target.deep).map((target) => target.path)).toEqual(helpers)
  })
  test('gives the hardened-runtime entitlements to every target that runs code, not the framework', () => {
    const signed = targets.filter((target) => target.entitlements).map((target) => target.path)
    expect(signed).not.toContain(framework)
    expect(signed).toEqual([...helpers, bun, app])
  })
})

describe('the entitlements file the release signs with', () => {
  const path = join(appRoot, ENTITLEMENTS)
  test('lives where make-dmg passes it to codesign', () => {
    expect(existsSync(path)).toBe(true)
  })
  test('allows the JIT and executable memory Bun and Chromium need under the hardened runtime', () => {
    const plist = readFileSync(path, 'utf8')
    expect(plist).toContain('<key>com.apple.security.cs.allow-jit</key>')
    expect(plist).toContain('<key>com.apple.security.cs.allow-unsigned-executable-memory</key>')
  })
})

describe('APP_BUNDLE_NAME', () => {
  test('is the name the DMG ships, so dragging it in installs Atlas.app', () => {
    expect(APP_BUNDLE_NAME).toBe('Atlas.app')
  })
})
