import { describe, expect, test } from 'bun:test'
import { executableOf, planHelperPlists } from '../helper-plists-plan'

const base = {
  os: 'macos',
  wrapperPath: '/b/Atlas.app',
  appIdentifier: 'io.byatlas.mac',
  helperBundles: ['bun Helper.app'],
}

describe('planHelperPlists', () => {
  test('writes a background-app plist into every helper bundle', () => {
    const decision = planHelperPlists(base)
    expect(decision.kind === 'write' && decision.plists.map((plist) => plist.path)).toEqual([
      '/b/Atlas.app/Contents/Frameworks/bun Helper.app/Contents/Info.plist',
    ])
  })
  test('hides the helper from the Dock and names its executable', () => {
    const decision = planHelperPlists(base)
    const contents = decision.kind === 'write' ? decision.plists[0]?.contents : undefined
    expect(contents).toContain('<key>LSUIElement</key>\n\t<true/>')
    expect(contents).toContain('<key>CFBundleExecutable</key>\n\t<string>bun Helper</string>')
    expect(contents).toContain(
      '<key>CFBundleIdentifier</key>\n\t<string>io.byatlas.mac.bun-helper</string>',
    )
  })
  test('gives each CEF helper its own identifier', () => {
    const decision = planHelperPlists({
      ...base,
      helperBundles: ['bun Helper (GPU).app', 'bun Helper (Renderer).app'],
    })
    const identifiers =
      decision.kind === 'write'
        ? decision.plists.map(
            (plist) => /CFBundleIdentifier<\/key>\n\t<string>(.*)</.exec(plist.contents)?.[1],
          )
        : []
    expect(identifiers).toEqual([
      'io.byatlas.mac.bun-helper-gpu',
      'io.byatlas.mac.bun-helper-renderer',
    ])
  })
  test('tolerates a trailing slash', () => {
    const decision = planHelperPlists({ ...base, wrapperPath: '/b/Atlas.app/' })
    expect(decision.kind === 'write' && decision.plists[0]?.path).toBe(
      '/b/Atlas.app/Contents/Frameworks/bun Helper.app/Contents/Info.plist',
    )
  })
  test('skips off macOS', () => {
    expect(planHelperPlists({ ...base, os: 'linux' }).kind).toBe('skip')
  })
  test('skips without a wrapper, an identifier or any helper', () => {
    expect(planHelperPlists({ ...base, wrapperPath: undefined }).kind).toBe('skip')
    expect(planHelperPlists({ ...base, appIdentifier: undefined }).kind).toBe('skip')
    expect(planHelperPlists({ ...base, helperBundles: [] }).kind).toBe('skip')
  })
})

test('executableOf drops the bundle suffix', () => {
  expect(executableOf({ bundle: 'bun Helper (Alerts).app' })).toBe('bun Helper (Alerts)')
})
