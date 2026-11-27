import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

import { ENativePickerEvent } from '../native-picker.js'

const appRoot = join(import.meta.dir, '..')
const nativeRoot = join(appRoot, 'native')
const read = (path) => readFileSync(path, 'utf8')

const swiftSources = () => {
  const directory = join(nativeRoot, 'src')
  return readdirSync(directory)
    .filter((name) => name.endsWith('.swift') || name.endsWith('.mm'))
    .map((name) => ({ name, text: read(join(directory, name)) }))
}

const addonEvents = () => {
  const text = read(join(nativeRoot, 'src', 'atlas_native.mm'))
  return [...text.matchAll(/kEvent\w+ = "([a-z]+)"/g)].map((match) => match[1]).sort()
}

describe('the native panel sources', () => {
  test('name the same events as the JS bridge', () => {
    expect(addonEvents()).toEqual(Object.values(ENativePickerEvent).sort())
  })

  test('declare the C surface the Swift half implements and calls', () => {
    const header = read(join(nativeRoot, 'include', 'AtlasNative.h'))
    for (const name of [
      'AtlasNativeShow',
      'AtlasNativeHide',
      'AtlasNativeShutdown',
      'AtlasNativeEmitSelect',
      'AtlasNativeEmitPin',
      'AtlasNativeEmitDismiss',
      'AtlasNativeEmitError',
    ]) {
      expect(header).toContain(name)
    }
    const bridge = read(join(nativeRoot, 'src', 'AtlasNativeBridge.swift'))
    for (const symbol of ['AtlasNativeShow', 'AtlasNativeHide', 'AtlasNativeShutdown']) {
      expect(bridge).toContain(`@_cdecl("${symbol}")`)
    }
  })

  test('never reach for a private glass selector', () => {
    for (const source of swiftSources()) expect(source.text).not.toContain('_variant')
    for (const source of swiftSources()) expect(source.text).not.toContain('unstable_')
  })

  test('keep the glass view and its interactive flag in one file', () => {
    const owners = swiftSources()
      .filter((source) => source.text.includes('NSGlassEffectView'))
      .map((source) => source.name)
    expect(owners).toEqual(['ModelPickerBackdrop.swift'])
    const glass = read(join(nativeRoot, 'src', 'ModelPickerBackdrop.swift'))
    expect(glass).toContain('#available(macOS 26.0, *)')
    expect(glass).toContain('NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency')
  })

  test('decode the request the bridge validates', () => {
    const request = read(join(nativeRoot, 'src', 'NativeModelRequest.swift'))
    for (const field of ['anchor', 'models', 'selected', 'pinned']) expect(request).toContain(field)
  })

  test('build the addon against the electron version the app runs', () => {
    const script = read(join(appRoot, 'scripts', 'build-native.ts'))
    expect(script).toContain('devDependencies?.electron')
    expect(script).toContain('--dist-url=https://electronjs.org/headers')
    expect(script).toContain("'prebuilds', 'darwin-arm64'")
  })
})
