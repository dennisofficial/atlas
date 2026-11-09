import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import type { IWebPayloadFs } from './install'
import { parseState, type IPayloadState } from './state'

const WEB_DIR = 'web'
const STATE_FILE = 'state.json'
const COMPLETE_FILE = '.complete'

function webDir(home: string): string {
  return join(home, WEB_DIR)
}

export function payloadRoot({ home, hash }: { home: string; hash: string }): string {
  return join(webDir(home), hash)
}

function stagingDir({ home, hash }: { home: string; hash: string }): string {
  return join(webDir(home), `.staging-${hash}`)
}

function downloadPath({ home, hash }: { home: string; hash: string }): string {
  return join(webDir(home), `.download-${hash}.tar.gz`)
}

function removePath({ path }: { path: string }): void {
  rmSync(path, { recursive: true, force: true })
}

function untar({ archivePath, into }: { archivePath: string; into: string }): void {
  const result = Bun.spawnSync({
    cmd: ['tar', '-xzf', archivePath, '-C', into],
    stdout: 'ignore',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0)
    throw new Error(`tar exited with ${result.exitCode}: ${result.stderr.toString()}`)
}

export function readPayloadState(home: string): IPayloadState {
  try {
    return parseState({ input: JSON.parse(readFileSync(join(webDir(home), STATE_FILE), 'utf8')) })
  } catch {
    return {}
  }
}

export function bunWebPayloadFs(): IWebPayloadFs {
  return {
    readState: async (home) => readPayloadState(home),
    writeState: async ({ home, state }) => {
      mkdirSync(webDir(home), { recursive: true })
      const target = join(webDir(home), STATE_FILE)
      const temporary = `${target}.tmp`
      writeFileSync(temporary, JSON.stringify(state))
      renameSync(temporary, target)
    },
    isComplete: ({ home, hash }) => existsSync(join(payloadRoot({ home, hash }), COMPLETE_FILE)),
    stage: async ({ home, hash, archive }) => {
      mkdirSync(webDir(home), { recursive: true })
      const archivePath = downloadPath({ home, hash })
      const staging = stagingDir({ home, hash })
      removePath({ path: staging })
      mkdirSync(staging, { recursive: true })
      writeFileSync(archivePath, archive)
      try {
        untar({ archivePath, into: staging })
      } finally {
        removePath({ path: archivePath })
      }
    },
    promote: async ({ home, hash }) => {
      const target = payloadRoot({ home, hash })
      removePath({ path: target })
      renameSync(stagingDir({ home, hash }), target)
      writeFileSync(join(target, COMPLETE_FILE), hash)
    },
    discard: ({ home, hash }) => {
      removePath({ path: payloadRoot({ home, hash }) })
      removePath({ path: stagingDir({ home, hash }) })
      removePath({ path: downloadPath({ home, hash }) })
    },
    list: (home) => {
      try {
        return readdirSync(webDir(home), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      } catch {
        return []
      }
    },
  }
}

export async function downloadBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

export async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.json()
}

export function sha256Of(bytes: Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
}
