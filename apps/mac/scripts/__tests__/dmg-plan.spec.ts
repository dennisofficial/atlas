import { describe, expect, test } from 'bun:test'
import { buildCreateDmgArgs, pickDmgName, readSigningEnv } from '../dmg-plan'

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

describe('pickDmgName', () => {
  test('finds the stable dmg and ignores update files', () => {
    expect(
      pickDmgName({
        files: ['stable-macos-arm64-update.json', 'macos-arm64-Atlas.dmg', 'x.tar.zst'],
      }),
    ).toBe('macos-arm64-Atlas.dmg')
  })
  test('returns null when absent', () => {
    expect(pickDmgName({ files: ['a.json'] })).toBeNull()
  })
})
