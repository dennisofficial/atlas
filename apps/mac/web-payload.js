import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  createWebUpdater,
  DESKTOP_CONTRACT,
  WEB_MANIFEST_URL,
  WEB_UPDATE_INTERVAL_MS,
} from './payload/web-payload.js'

const STATE_FILE = 'state.json'
const COMPLETE_FILE = '.complete'
const PAYLOAD_HASH = /^[0-9a-f]{16}$/
const STATE_FIELDS = ['current', 'previous', 'failed', 'appVersion', 'version']
const MANIFEST_URL_ENV = 'ATLAS_WEB_PAYLOAD_URL'

export function payloadHomeOf({ userData }) {
  return join(userData, 'web-payload')
}

export function payloadRootAt({ home, hash }) {
  return join(home, hash)
}

export function payloadWebRoot({ home, hash }) {
  return join(payloadRootAt({ home, hash }), 'apps', 'web')
}

export function webRootFor({ home, bundledRoot, installedHash }) {
  return installedHash === undefined ? bundledRoot : payloadWebRoot({ home, hash: installedHash })
}

export function manifestUrlOf({ env }) {
  const override = env[MANIFEST_URL_ENV]
  return override === undefined || override.length === 0 ? WEB_MANIFEST_URL : override
}

function stagingDirAt({ home, hash }) {
  return join(home, `.staging-${hash}`)
}

function downloadPathAt({ home, hash }) {
  return join(home, `.download-${hash}.tar.gz`)
}

function removePath({ path }) {
  rmSync(path, { recursive: true, force: true })
}

function untar({ archivePath, into }) {
  const result = spawnSync('tar', ['-xzf', archivePath, '-C', into], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  if (result.status !== 0)
    throw new Error(`tar exited with ${result.status}: ${result.stderr?.toString() ?? ''}`)
}

export function parsePayloadState(input) {
  if (typeof input !== 'object' || input === null) return {}
  const state = {}
  for (const field of STATE_FIELDS) {
    if (typeof input[field] === 'string') state[field] = input[field]
  }
  return state
}

export function electronWebPayloadFs() {
  return {
    readState: async (home) => {
      try {
        return parsePayloadState(JSON.parse(await readFile(join(home, STATE_FILE), 'utf8')))
      } catch {
        return {}
      }
    },
    writeState: async ({ home, state }) => {
      await mkdir(home, { recursive: true })
      const target = join(home, STATE_FILE)
      const temporary = `${target}.tmp`
      await writeFile(temporary, JSON.stringify(state))
      await rename(temporary, target)
    },
    isComplete: ({ home, hash }) => existsSync(join(payloadRootAt({ home, hash }), COMPLETE_FILE)),
    stage: async ({ home, hash, archive }) => {
      await mkdir(home, { recursive: true })
      const archivePath = downloadPathAt({ home, hash })
      const staging = stagingDirAt({ home, hash })
      removePath({ path: staging })
      await mkdir(staging, { recursive: true })
      await writeFile(archivePath, archive)
      try {
        untar({ archivePath, into: staging })
      } finally {
        removePath({ path: archivePath })
      }
    },
    promote: async ({ home, hash }) => {
      const target = payloadRootAt({ home, hash })
      removePath({ path: target })
      await rename(stagingDirAt({ home, hash }), target)
      await writeFile(join(target, COMPLETE_FILE), hash)
    },
    discard: ({ home, hash }) => {
      removePath({ path: payloadRootAt({ home, hash }) })
      removePath({ path: stagingDirAt({ home, hash }) })
      removePath({ path: downloadPathAt({ home, hash }) })
    },
    list: (home) => {
      try {
        return readdirSync(home, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && PAYLOAD_HASH.test(entry.name))
          .map((entry) => entry.name)
      } catch {
        return []
      }
    },
  }
}

export async function fetchJsonOf(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.json()
}

export async function downloadBytesOf(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

export function sha256Of(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function createElectronWebUpdater({
  home,
  appVersion,
  manifestUrl = WEB_MANIFEST_URL,
  contract = DESKTOP_CONTRACT,
  fetchJson = fetchJsonOf,
  download = downloadBytesOf,
  log = ({ label, error }) => console.error(`[${label}]`, error),
  intervalMs = WEB_UPDATE_INTERVAL_MS,
}) {
  const updater = createWebUpdater({
    home,
    manifestUrl,
    contract,
    appVersion,
    intervalMs,
    ports: {
      fs: electronWebPayloadFs(),
      fetchJson,
      download,
      sha256: sha256Of,
      log,
      setInterval: (handler, ms) => setInterval(handler, ms),
      clearInterval: (timer) => clearInterval(timer),
    },
  })

  let timer
  let checking = false

  const poll = async ({ onPayload }) => {
    if (checking) return
    checking = true
    try {
      await updater.check()
      const hash = updater.pending()
      if (hash === undefined) return
      const swapped = await onPayload({ hash }).catch((error) => {
        log({ label: 'web-payload-swap', error })
        return false
      })
      if (swapped === true) updater.applied()
    } finally {
      checking = false
    }
  }

  return {
    updater,
    launchRoot: async ({ bundledRoot }) =>
      webRootFor({ home, bundledRoot, installedHash: await updater.installedRoot() }),
    start: ({ onPayload }) => {
      void poll({ onPayload })
      if (timer !== undefined) return
      timer = setInterval(() => void poll({ onPayload }), intervalMs)
    },
    stop: () => {
      if (timer === undefined) return
      clearInterval(timer)
      timer = undefined
    },
  }
}
