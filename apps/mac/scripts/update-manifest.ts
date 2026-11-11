import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const LATEST_MANIFEST = 'latest-mac.yml'

export function zipNameOf({ dir }: { dir: string }): string {
  const zips = readdirSync(dir).filter((name) => name.endsWith('.zip'))
  const [only] = zips
  if (zips.length !== 1 || only === undefined)
    throw new Error(`expected one .zip in ${dir}, found ${zips.length}`)
  return only
}

export function latestManifest({
  version,
  zipName,
  bytes,
  releasedAt,
}: {
  version: string
  zipName: string
  bytes: Uint8Array
  releasedAt: string
}): string {
  const sha512 = createHash('sha512').update(bytes).digest('base64')
  return [
    `version: "${version}"`,
    'files:',
    `  - url: "${zipName}"`,
    `    sha512: "${sha512}"`,
    `    size: ${bytes.byteLength}`,
    `path: "${zipName}"`,
    `sha512: "${sha512}"`,
    `releaseDate: "${releasedAt}"`,
    '',
  ].join('\n')
}

function argumentOf({ args, name }: { args: string[]; name: string }): string | undefined {
  const at = args.indexOf(`--${name}`)
  if (at < 0) return undefined
  return args[at + 1]
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const dir = argumentOf({ args, name: 'dir' }) ?? 'release'
  const version = argumentOf({ args, name: 'version' })
  if (version === undefined) throw new Error('--version is required')
  const zipName = zipNameOf({ dir })
  const releasedAt = argumentOf({ args, name: 'released-at' }) ?? new Date().toISOString()
  const manifest = latestManifest({
    version,
    zipName,
    bytes: readFileSync(join(dir, zipName)),
    releasedAt,
  })
  writeFileSync(join(dir, LATEST_MANIFEST), manifest)
  console.log(manifest)
}
