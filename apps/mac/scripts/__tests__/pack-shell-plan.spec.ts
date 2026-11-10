import { describe, expect, test } from 'bun:test'
import { posix } from 'node:path'

import {
  bundlePaths,
  CEF_HELPERS,
  CEF_FRAMEWORK,
  HELPER_FRAMEWORK_LINK,
  helperIdentifier,
  helperInfoPlist,
  helperName,
  helperPath,
  SHELL_IDENTIFIER,
  SHELL_NAME,
  shellInfoPlist,
  signTargets,
} from '../pack-shell-plan'

const bundle = '/w/build/AtlasShell.app'
const paths = bundlePaths({ bundle, app: SHELL_NAME })

describe('the bundle layout', () => {
  test('puts the shell binary in MacOS and the payload in Resources', () => {
    expect(paths.executable).toBe('/w/build/AtlasShell.app/Contents/MacOS/AtlasShell')
    expect(paths.webServer).toBe(
      '/w/build/AtlasShell.app/Contents/Resources/web-standalone/apps/web/server.js',
    )
    expect(paths.hostScript).toBe('/w/build/AtlasShell.app/Contents/Resources/app/host.js')
  })
  test('puts the CEF framework in Frameworks', () => {
    expect(paths.framework).toBe(
      '/w/build/AtlasShell.app/Contents/Frameworks/Chromium Embedded Framework.framework',
    )
  })
})

describe('the CEF helpers', () => {
  test('names the four Chromium helpers after the shell', () => {
    expect(CEF_HELPERS.map((helper) => helperName({ app: SHELL_NAME, helper }))).toEqual([
      'AtlasShell Helper',
      'AtlasShell Helper (GPU)',
      'AtlasShell Helper (Renderer)',
      'AtlasShell Helper (Alerts)',
    ])
  })
  test('gives each helper its own identifier', () => {
    expect(
      CEF_HELPERS.map((helper) => helperIdentifier({ identifier: SHELL_IDENTIFIER, helper })),
    ).toEqual([
      'io.byatlas.mac.shell.helper',
      'io.byatlas.mac.shell.helper.gpu',
      'io.byatlas.mac.shell.helper.renderer',
      'io.byatlas.mac.shell.helper.alerts',
    ])
  })
  test('links each helper to the framework three levels up', () => {
    for (const helper of CEF_HELPERS) {
      const helperBundle = helperPath({ frameworks: paths.frameworks, app: SHELL_NAME, helper })
      const linkDir = posix.join(helperBundle, 'Contents', 'Frameworks')
      expect(posix.normalize(posix.join(linkDir, HELPER_FRAMEWORK_LINK))).toBe(paths.framework)
      expect(HELPER_FRAMEWORK_LINK.endsWith(CEF_FRAMEWORK)).toBe(true)
    }
  })
  test('marks every helper as an accessory app so none claims a Dock tile', () => {
    for (const helper of CEF_HELPERS) {
      const plist = helperInfoPlist({
        app: SHELL_NAME,
        identifier: SHELL_IDENTIFIER,
        version: '0.1.0',
        helper,
      })
      expect(plist).toContain('<key>LSUIElement</key>\n\t<true/>')
    }
  })
})

describe('the app plist', () => {
  const plist = shellInfoPlist({ identifier: SHELL_IDENTIFIER, version: '0.1.0' })
  test('names the executable, the principal class and the minimum system', () => {
    expect(plist).toContain('<key>CFBundleExecutable</key>\n\t<string>AtlasShell</string>')
    expect(plist).toContain('<key>NSPrincipalClass</key>\n\t<string>NSApplication</string>')
    expect(plist).toContain('<key>LSMinimumSystemVersion</key>\n\t<string>14.0</string>')
  })
  test('is a launchable application bundle', () => {
    expect(plist).toContain('<key>CFBundlePackageType</key>\n\t<string>APPL</string>')
    expect(plist.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
  })
})

describe('signTargets', () => {
  const targets = signTargets({ bundle, app: SHELL_NAME })
  test('signs the framework, then every helper deeply, then the app', () => {
    expect(targets).toHaveLength(6)
    expect(targets[0]).toEqual({ path: paths.framework, deep: false })
    expect(targets.slice(1, 5).every((target) => target.deep)).toBe(true)
    expect(targets[5]).toEqual({ path: bundle, deep: false })
  })
})
