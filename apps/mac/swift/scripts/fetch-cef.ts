import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const INDEX_URL = 'https://cef-builds.spotifycdn.com/index.json'
const BUILD_URL = 'https://cef-builds.spotifycdn.com'
const PLATFORM = 'macosarm64'
const DISTRIBUTION = 'minimal'
const CEF_VERSION = '156.0.26+g8ea0c73+chromium-156.0.8078.88'

const packageRoot = join(import.meta.dir, '..')
const cefRoot = join(packageRoot, '.cef')
const frameworkDir = join(cefRoot, 'Release', 'Chromium Embedded Framework.framework')
const versionStamp = join(cefRoot, '.version')

interface CefFile {
  name: string
  size: number
  sha1: string
  sha256?: string
  type: string
}

interface CefVersion {
  cef_version: string
  channel: string
  files: CefFile[]
}

interface CefIndex {
  [platform: string]: { versions: CefVersion[] }
}

export function pickDistribution(index: CefIndex): CefFile {
  const version = index[PLATFORM]?.versions.find((entry) => entry.cef_version === CEF_VERSION)
  if (!version) throw new Error(`CEF ${CEF_VERSION} has no ${PLATFORM} build in the index`)
  const file = version.files.find((entry) => entry.type === DISTRIBUTION)
  if (!file) throw new Error(`CEF ${CEF_VERSION} ${PLATFORM} has no ${DISTRIBUTION} build`)
  return file
}

// The distribution index carries only sha1 for every entry, so that is the strongest digest it can prove.
export function digestOf(file: CefFile): { algorithm: 'sha256' | 'sha1'; value: string } {
  return file.sha256
    ? { algorithm: 'sha256', value: file.sha256 }
    : { algorithm: 'sha1', value: file.sha1 }
}

async function cached(): Promise<boolean> {
  if (!existsSync(frameworkDir) || !existsSync(versionStamp)) return false
  const stamp = await readFile(versionStamp, 'utf8')
  return stamp.trim() === CEF_VERSION
}

async function download(file: CefFile): Promise<string> {
  const target = join(cefRoot, 'download', file.name)
  await mkdir(join(cefRoot, 'download'), { recursive: true })
  const response = await fetch(`${BUILD_URL}/${file.name}`)
  if (!response.ok) throw new Error(`download failed: ${response.status} ${response.statusText}`)
  const bytes = Buffer.from(await response.arrayBuffer())

  const { algorithm, value } = digestOf(file)
  const actual = createHash(algorithm).update(bytes).digest('hex')
  if (actual !== value)
    throw new Error(`${algorithm} mismatch: index says ${value}, download is ${actual}`)
  if (bytes.byteLength !== file.size) {
    throw new Error(`size mismatch: index says ${file.size}, download is ${bytes.byteLength}`)
  }
  await writeFile(target, bytes)
  console.log(`downloaded ${file.name} (${bytes.byteLength} bytes, ${algorithm} ok)`)
  return target
}

async function extract(archive: string): Promise<void> {
  const result = Bun.spawnSync(['tar', '-xjf', archive, '-C', cefRoot, '--strip-components=1'])
  if (result.exitCode !== 0) {
    throw new Error(`tar failed: ${result.stderr.toString()}`)
  }
}

async function layout(): Promise<void> {
  const entries = await readdir(cefRoot, { withFileTypes: true })
  console.log(`\n${cefRoot}:`)
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${entry.isDirectory() ? 'dir ' : 'file'} ${entry.name}`)
  }
  const release = await readdir(join(cefRoot, 'Release'))
  console.log('\nRelease/:')
  for (const name of release.sort()) {
    const info = await stat(join(cefRoot, 'Release', name))
    console.log(`  ${info.isDirectory() ? 'dir ' : 'file'} ${name}`)
  }
  console.log(`\nframework: ${frameworkDir}`)
  console.log(`headers:   ${join(cefRoot, 'include')}`)
}

async function main(): Promise<void> {
  await mkdir(cefRoot, { recursive: true })
  if (await cached()) {
    console.log(`CEF ${CEF_VERSION} already fetched`)
    await layout()
    return
  }

  const index = (await (await fetch(INDEX_URL)).json()) as CefIndex
  const file = pickDistribution(index)
  const archive = await download(file)
  await rm(join(cefRoot, 'include'), { recursive: true, force: true })
  await rm(join(cefRoot, 'Release'), { recursive: true, force: true })
  await extract(archive)
  await rm(join(cefRoot, 'download'), { recursive: true, force: true })
  await writeFile(versionStamp, `${CEF_VERSION}\n`)
  await layout()
}

if (import.meta.main) {
  await main()
}
