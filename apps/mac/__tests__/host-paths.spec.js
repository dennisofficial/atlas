import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  HostMissingError,
  hostEnvironment,
  hostMarkersIn,
  resolveBun,
  resolveHostScript,
  webRootAt,
} from '../host-paths.js'

let root

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'atlas-electron-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const touch = (path) => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '')
}

describe('resolveHostScript', () => {
  test('prefers ATLAS_HOST_SCRIPT', () => {
    const script = resolveHostScript({
      env: { ATLAS_HOST_SCRIPT: '/custom/host.js' },
      resourcesPath: '/missing',
      appRoot: '/missing',
    })
    expect(script).toBe('/custom/host.js')
  })

  test('takes the bundled host before the dev entry', () => {
    const resources = join(root, 'Resources')
    touch(join(resources, 'app', 'host.js'))
    const appRoot = join(root, 'apps', 'mac')
    touch(join(appRoot, '..', 'mac', 'src', 'desktop-host', 'index.ts'))
    const script = resolveHostScript({ env: {}, resourcesPath: resources, appRoot })
    expect(script).toBe(join(resources, 'app', 'host.js'))
  })

  test('falls back to the source checkout', () => {
    const appRoot = join(root, 'apps', 'mac')
    const dev = join(appRoot, '..', 'mac', 'src', 'desktop-host', 'index.ts')
    touch(dev)
    const script = resolveHostScript({ env: {}, resourcesPath: join(root, 'none'), appRoot })
    expect(script).toBe(dev)
  })

  test('names the path it could not find', () => {
    const appRoot = join(root, 'apps', 'mac')
    const missing = join(appRoot, '..', 'mac', 'src', 'desktop-host', 'index.ts')
    expect(() => resolveHostScript({ env: {}, resourcesPath: undefined, appRoot })).toThrow(
      HostMissingError,
    )
    expect(() => resolveHostScript({ env: {}, resourcesPath: undefined, appRoot })).toThrow(missing)
  })
})

describe('resolveBun', () => {
  test('prefers ATLAS_BUN', () => {
    expect(resolveBun({ env: { ATLAS_BUN: '/custom/bun' } })).toBe('/custom/bun')
  })

  test('takes the bundled runtime', () => {
    const resources = join(root, 'Resources')
    touch(join(resources, 'bin', 'bun'))
    expect(resolveBun({ env: {}, resourcesPath: resources })).toBe(join(resources, 'bin', 'bun'))
  })

  test('falls back to bun on PATH', () => {
    expect(resolveBun({ env: {}, resourcesPath: join(root, 'none') })).toBe('bun')
  })
})

test('webRootAt points at the standalone app', () => {
  expect(webRootAt({ resourcesPath: '/Resources' })).toBe(
    join('/Resources', 'web-standalone', 'apps', 'web'),
  )
})

test('hostEnvironment sets the pane origin, web root and app version over the inherited environment', () => {
  const environment = hostEnvironment({
    base: { PATH: '/bin', ATLAS_WEB_ROOT: '/stale', ATLAS_VERSION: '0.0.0' },
    paneOrigin: 'http://127.0.0.1:9000',
    updateOrigin: 'http://127.0.0.1:9000',
    webRoot: '/Resources/web-standalone/apps/web',
    appVersion: '1.314.1',
  })
  expect(environment).toEqual({
    PATH: '/bin',
    ATLAS_WEB_ROOT: '/Resources/web-standalone/apps/web',
    ATLAS_PANE_ORIGIN: 'http://127.0.0.1:9000',
    ATLAS_UPDATE_ORIGIN: 'http://127.0.0.1:9000',
    ATLAS_VERSION: '1.314.1',
  })
})

test('hostEnvironment carries the app version the packaged app reports', () => {
  const environment = hostEnvironment({ base: { PATH: '/bin' }, appVersion: '1.315.1' })
  expect(environment.ATLAS_VERSION).toBe('1.315.1')
  expect(hostEnvironment({ base: { PATH: '/bin' } }).ATLAS_VERSION).toBeUndefined()
})

test('hostEnvironment leaves the pane origin unset without a listener', () => {
  const environment = hostEnvironment({ base: { PATH: '/bin' }, webRoot: '/web' })
  expect(environment.ATLAS_PANE_ORIGIN).toBeUndefined()
  expect(environment.ATLAS_UPDATE_ORIGIN).toBeUndefined()
  expect(environment.ATLAS_WEB_ROOT).toBe('/web')
  expect(environment.ATLAS_VERSION).toBeUndefined()
})

describe('hostMarkersIn', () => {
  const lines = [
    'booting',
    'ATLAS_URL=https://127.0.0.1:2/desktop/session?secret=s',
    'ATLAS_HTTP_ORIGIN=http://127.0.0.1:1',
    'ATLAS_CERT=sha256/AbC=',
  ].join('\n')

  test('waits for the session URL, the HTTP origin and the certificate together', () => {
    expect(hostMarkersIn('booting\nATLAS_URL=https://127.0.0.1:2/x\n')).toBeUndefined()
    expect(hostMarkersIn(lines)).toEqual({
      url: 'https://127.0.0.1:2/desktop/session?secret=s',
      httpOrigin: 'http://127.0.0.1:1',
      fingerprint: 'sha256/AbC=',
    })
  })

  test('ignores a marker line with nothing after it', () => {
    expect(hostMarkersIn(`${lines}\nATLAS_CERT=\n`)).toEqual({
      url: 'https://127.0.0.1:2/desktop/session?secret=s',
      httpOrigin: 'http://127.0.0.1:1',
      fingerprint: 'sha256/AbC=',
    })
  })
})
