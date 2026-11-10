import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

import { DESKTOP_CONTRACT } from '../src/host/contract'

export interface IPackedPayload {
  hash: string
  artifactPath: string
  manifestPath: string
  size: number
  sha256: string
}

function archive({ root, target }: { root: string; target: string }): void {
  const result = Bun.spawnSync({
    cmd: ['tar', '-czf', target, '-C', root, '.'],
    stdout: 'ignore',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0)
    throw new Error(`tar exited with ${result.exitCode}: ${result.stderr.toString()}`)
}

export function packWebPayload({
  root,
  outDir,
  builtAt = new Date().toISOString(),
  contract = DESKTOP_CONTRACT,
  version,
}: {
  root: string
  outDir: string
  builtAt?: string
  contract?: number
  version?: string
}): IPackedPayload {
  const source = resolve(root)
  if (!existsSync(join(source, 'apps', 'web', 'server.js')))
    throw new Error(`${source} is not a web standalone build: apps/web/server.js is missing`)

  const out = resolve(outDir)
  mkdirSync(out, { recursive: true })
  const pending = join(out, 'web-pending.tar.gz')
  rmSync(pending, { force: true })
  archive({ root: source, target: pending })

  const bytes = readFileSync(pending)
  const sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
  const hash = sha256.slice(0, 16)
  const artifact = `web-${hash}.tar.gz`
  const artifactPath = join(out, artifact)
  renameSync(pending, artifactPath)

  const manifestPath = join(out, 'web-update.json')
  const manifest = {
    schemaVersion: 1,
    ...(version === undefined ? {} : { version }),
    hash,
    artifact,
    sha256,
    size: statSync(artifactPath).size,
    builtAt,
    requiresShell: contract,
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  return { hash, artifactPath, manifestPath, size: manifest.size, sha256 }
}

if (import.meta.main) {
  const root = process.argv[2] ?? 'web-standalone'
  const outDir = process.argv[3] ?? 'artifacts'
  const version = process.env.ATLAS_VERSION?.trim()
  const packed = packWebPayload({
    root,
    outDir,
    ...(version === undefined || version.length === 0 ? {} : { version }),
  })
  console.log(`packed ${packed.artifactPath} (${packed.size} bytes, hash ${packed.hash})`)
}
