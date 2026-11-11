import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, test } from 'bun:test'

import { EWebPayloadState } from '../payload/web-payload.js'
import {
  createElectronWebUpdater,
  payloadHomeOf,
  payloadWebRoot,
  webRootFor,
} from '../web-payload.js'

const APP_VERSION = '0.1.0'
const BUNDLED_ROOT = '/Applications/Atlas.app/Contents/Resources/web-standalone/apps/web'

let root
let home

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'atlas-electron-payload-'))
  home = payloadHomeOf({ userData: join(root, 'userData') })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function sha256Of(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function archiveOf({ marker }) {
  const source = join(root, `source-${marker}`)
  mkdirSync(join(source, 'apps', 'web'), { recursive: true })
  writeFileSync(join(source, 'apps', 'web', 'server.js'), `// ${marker}\n`)
  const archive = join(root, `payload-${marker}.tar.gz`)
  const result = spawnSync('tar', ['-czf', archive, '-C', source, '.'], { stdio: 'ignore' })
  if (result.status !== 0) throw new Error(`tar exited with ${result.status}`)
  return new Uint8Array(readFileSync(archive))
}

function manifestFor({ bytes, version, overrides = {} }) {
  const hash = sha256Of(bytes).slice(0, 16)
  return {
    schemaVersion: 1,
    version,
    hash,
    artifact: `web-${hash}.tar.gz`,
    sha256: sha256Of(bytes),
    size: bytes.byteLength,
    builtAt: new Date().toISOString(),
    requiresShell: 1,
    ...overrides,
  }
}

function updaterFor({ manifest, bytes, fetchJson }) {
  return createElectronWebUpdater({
    home,
    appVersion: APP_VERSION,
    manifestUrl: 'https://updates.test/web-update.json',
    fetchJson: fetchJson ?? (async () => manifest),
    download: async () => bytes,
    log: () => {},
  })
}

test('a newer payload wins', async () => {
  const bytes = archiveOf({ marker: 'newer' })
  const manifest = manifestFor({ bytes, version: '9.9.9' })
  const payloads = updaterFor({ manifest, bytes })

  const status = await payloads.updater.check()

  expect(status.state).toBe(EWebPayloadState.Ready)
  expect(payloads.updater.pending()).toBe(manifest.hash)
  expect(await payloads.updater.installedRoot()).toBe(manifest.hash)
  expect(await payloads.updater.installedVersion()).toBe('9.9.9')
  expect(existsSync(join(payloadWebRoot({ home, hash: manifest.hash }), 'server.js'))).toBe(true)
  expect(await payloads.launchRoot({ bundledRoot: BUNDLED_ROOT })).toBe(
    payloadWebRoot({ home, hash: manifest.hash }),
  )
})

test('a hash mismatch keeps the bundled tree', async () => {
  const bytes = archiveOf({ marker: 'bad-hash' })
  const manifest = manifestFor({ bytes, version: '9.9.9', overrides: { sha256: 'a'.repeat(64) } })
  const payloads = updaterFor({ manifest, bytes })

  const status = await payloads.updater.check()

  expect(status.state).toBe(EWebPayloadState.Idle)
  expect(status.error).toContain('hash-mismatch')
  expect(await payloads.updater.installedRoot()).toBeUndefined()
  expect(existsSync(join(home, manifest.hash))).toBe(false)
  expect(webRootFor({ home, bundledRoot: BUNDLED_ROOT, installedHash: undefined })).toBe(
    BUNDLED_ROOT,
  )
})

test('offline keeps the bundled tree', async () => {
  const payloads = updaterFor({
    fetchJson: async () => {
      throw new TypeError('fetch failed')
    },
  })

  const status = await payloads.updater.check()

  expect(status.state).toBe(EWebPayloadState.Idle)
  expect(status.error).toContain('fetch failed')
  expect(await payloads.launchRoot({ bundledRoot: BUNDLED_ROOT })).toBe(BUNDLED_ROOT)
})

test('a pending payload reaches the swap callback once', async () => {
  const bytes = archiveOf({ marker: 'swap' })
  const manifest = manifestFor({ bytes, version: '9.9.9' })
  const payloads = updaterFor({ manifest, bytes })

  const seen = new Promise((resolve) => {
    payloads.start({
      onPayload: async ({ hash }) => {
        resolve(hash)
        return true
      },
    })
  })

  try {
    expect(await seen).toBe(manifest.hash)
    await Bun.sleep(0)
  } finally {
    payloads.stop()
  }
  expect(payloads.updater.pending()).toBeUndefined()
})
