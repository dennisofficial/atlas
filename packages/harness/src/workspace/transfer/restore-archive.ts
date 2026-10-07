import { createReadStream } from 'node:fs'
import { readFile, rm, writeFile, stat } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { createGunzip } from 'node:zlib'

import { assertFamilyManifest } from './family-manifest'
import { workspaceManifestSchema, type WorkspaceManifest } from './manifest'

const BLOCK = 512
const META_TYPES = new Set(['x', 'g', 'L', 'K'])
const ALLOWED_TYPES = new Set(['0', '5', '2', '1'])
const HARDLINK = '1'
const SYMLINK = '2'
const PROBE = '.case-probe'

const LAYOUT = /^(?:manifest\.json|git(?:\/.+)?|trees\/[A-Za-z0-9_-]+\/(?:files|git-state|index)(?:\/.+)?)$/
const FORBIDDEN = new RegExp(
  [
    '^git/worktrees(?:/|$)',
    '^git/objects/info/alternates$',
    '^trees/[^/]+/files/\\.git(?:/|$)',
    '^trees/[^/]+/git-state/(?:commondir|gitdir|locked|index)$',
  ].join('|'),
)

type RawEntry = { path: string; type: string; linkpath: string }

const META_LIMIT = 1024 * 1024

const openChunks = async (archivePath: string): Promise<AsyncIterator<Uint8Array>> => {
  const head = new Uint8Array(await Bun.file(archivePath).slice(0, 2).arrayBuffer())
  const raw = createReadStream(archivePath)
  const stream = head[0] === 0x1f && head[1] === 0x8b ? raw.pipe(createGunzip()) : raw
  return stream[Symbol.asyncIterator]()
}

const sourceOf = (chunks: AsyncIterator<Uint8Array>) => {
  let pending: Buffer = Buffer.alloc(0)
  const pull = async (): Promise<boolean> => {
    const next = await chunks.next()
    if (next.done) return false
    const chunk = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength)
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])
    return true
  }
  return {
    async take(count: number): Promise<Buffer | null> {
      while (pending.length < count) if (!(await pull())) return null
      const out = pending.subarray(0, count)
      pending = pending.subarray(count)
      return out
    },
    async skip(count: number): Promise<void> {
      let left = count
      while (left > 0) {
        if (pending.length === 0 && !(await pull())) throw new Error('archive is truncated')
        const cut = Math.min(left, pending.length)
        pending = pending.subarray(cut)
        left -= cut
      }
    },
  }
}

const textAt = (block: Buffer, offset: number, length: number): string => {
  const field = block.subarray(offset, offset + length)
  const end = field.indexOf(0)
  return field.subarray(0, end < 0 ? length : end).toString('utf8')
}

const sizeOf = (block: Buffer): number => {
  const field = block.subarray(124, 136)
  if (((field[0] ?? 0) & 0x80) !== 0) return field.subarray(1).reduce((total, byte) => total * 256 + byte, 0)
  return Number.parseInt(textAt(block, 124, 12).trim() || '0', 8)
}

const paxRecords = (body: Buffer): Map<string, string> => {
  const found = new Map<string, string>()
  let offset = 0
  while (offset < body.length) {
    const space = body.indexOf(0x20, offset)
    const length = space < 0 ? Number.NaN : Number(body.subarray(offset, space).toString())
    if (!Number.isInteger(length) || length <= 0) throw new Error('archive has a malformed extended header')
    const record = body.subarray(space + 1, offset + length - 1).toString('utf8')
    const separator = record.indexOf('=')
    if (separator > 0) found.set(record.slice(0, separator), record.slice(separator + 1))
    offset += length
  }
  return found
}

async function* readEntries({ archivePath }: { archivePath: string }): AsyncGenerator<RawEntry> {
  const source = sourceOf(await openChunks(archivePath))
  let path: string | null = null
  let linkpath: string | null = null
  let declaredSize: number | null = null
  for (;;) {
    const block = await source.take(BLOCK)
    if (block === null || block.every((byte) => byte === 0)) return
    const raw = block[156] ?? 0
    const type = raw === 0 ? '0' : String.fromCharCode(raw)
    const size = type === 'x' || type === 'g' || type === 'L' || type === 'K' ? sizeOf(block) : (declaredSize ?? sizeOf(block))
    if (META_TYPES.has(type) && size > META_LIMIT) throw new Error('archive has an oversized metadata header')
    const padded = Math.ceil(size / BLOCK) * BLOCK
    if (META_TYPES.has(type)) {
      const body = padded === 0 ? Buffer.alloc(0) : await source.take(padded)
      if (body === null) throw new Error('archive is truncated')
      const data = body.subarray(0, size)
      if (type === 'x') {
        const records = paxRecords(data)
        path = records.get('path') ?? path
        linkpath = records.get('linkpath') ?? linkpath
        const override = records.get('size')
        if (override !== undefined) declaredSize = Number(override)
        if (declaredSize !== null && !Number.isSafeInteger(declaredSize)) throw new Error('archive has a malformed size')
      }
      if (type === 'g') {
        const records = paxRecords(data)
        if (['path', 'linkpath', 'size'].some((key) => records.has(key))) {
          throw new Error('archive uses global extended headers that change entry paths or sizes')
        }
      }
      if (type === 'L') path = data.toString('utf8').replace(/\0+$/, '')
      if (type === 'K') linkpath = data.toString('utf8').replace(/\0+$/, '')
      continue
    }
    const prefix = block.subarray(257, 263).toString() === 'ustar\0' ? textAt(block, 345, 155) : ''
    const name = textAt(block, 0, 100)
    yield {
      path: path ?? (prefix === '' ? name : `${prefix}/${name}`),
      type,
      linkpath: linkpath ?? textAt(block, 157, 100),
    }
    path = null
    linkpath = null
    declaredSize = null
    await source.skip(padded)
  }
}

const cleanPath = (raw: string): string => {
  const trimmed = raw.replace(/^(?:\.\/)+/, '').replace(/\/+$/, '')
  const segments = trimmed.split('/')
  const unsafe = trimmed === '' || trimmed.includes('\0') || segments.some((part) => part === '' || part === '.' || part === '..')
  if (unsafe) throw new Error(`archive entry has an unsafe path: ${JSON.stringify(raw)}`)
  return trimmed
}

const mountOf = (path: string): string => {
  const parts = path.split('/')
  return parts[0] === 'trees' ? parts.slice(0, 3).join('/') : (parts[0] ?? path)
}

const isRemappable = ({ path, type }: { path: string; type: string }): boolean => {
  if (type === '5') return false
  if (path.startsWith('git/')) return !path.startsWith('git/objects/')
  return path.includes('/git-state/') || (posix.basename(path) === '.git' && type === '0')
}

export async function isCaseInsensitive({ directory }: { directory: string }): Promise<boolean> {
  await writeFile(join(directory, PROBE), '')
  const folded = await stat(join(directory, PROBE.toUpperCase())).then(() => true, () => false)
  await rm(join(directory, PROBE), { force: true })
  return folded
}

export async function scanWorkspaceArchive({
  archivePath,
  caseInsensitive,
}: {
  archivePath: string
  caseInsensitive: boolean
}): Promise<string[]> {
  const seen = new Map<string, string>()
  const occupied = new Set<string>()
  const ancestors = new Set<string>()
  const files = new Set<string>()
  const remappable: string[] = []
  for await (const entry of readEntries({ archivePath })) {
    const path = cleanPath(entry.path)
    if (!LAYOUT.test(path) || FORBIDDEN.test(path)) throw new Error(`archive entry is outside the workspace layout: ${path}`)
    if (!ALLOWED_TYPES.has(entry.type)) {
      throw new Error(`archive entry ${path} has an unsupported entry type (${entry.type}); only files, directories and symbolic links are restored`)
    }
    const fold = (value: string): string => (caseInsensitive ? value.normalize('NFC').toLowerCase() : value)
    if (entry.type === HARDLINK) {
      const target = cleanPath(entry.linkpath)
      const sameMount = mountOf(target) === mountOf(path)
      if (!files.has(fold(target)) || !sameMount) {
        throw new Error(`archive entry ${path} is a hard link to ${entry.linkpath}, which is not an earlier file of the same tree`)
      }
    }
    const key = fold(path)
    const previous = seen.get(key)
    if (previous !== undefined) {
      throw new Error(
        previous === path
          ? `archive lists ${path} twice`
          : `archive paths ${previous} and ${path} collide on a case-insensitive filesystem`,
      )
    }
    seen.set(key, path)
    for (let parent = posix.dirname(path); parent !== '.'; parent = posix.dirname(parent)) {
      if (occupied.has(fold(parent))) throw new Error(`archive entry ${path} passes through the non-directory ${parent}`)
      ancestors.add(fold(parent))
    }
    if (entry.type !== '5') {
      if (ancestors.has(key)) throw new Error(`archive entry ${path} replaces a directory that holds other entries`)
      occupied.add(key)
      if (entry.type !== SYMLINK) files.add(key)
    }
    if (isRemappable({ path, type: entry.type })) remappable.push(path)
  }
  return remappable
}

const assertManifest = (manifest: WorkspaceManifest): void => {
  const ids = new Set(manifest.trees.map((tree) => tree.id))
  const relative = manifest.activeRelativePath
  const unsafe = relative.startsWith('/') || relative.includes('\0') || relative.split('/').includes('..')
  if (ids.size !== manifest.trees.length) throw new Error('archive manifest repeats a tree id')
  if (!ids.has(manifest.activeId)) throw new Error('archive manifest names an active tree that does not exist')
  if (unsafe) throw new Error(`archive manifest has an unsafe active path: ${relative}`)
  if (manifest.repository === null && manifest.trees.length !== 1) throw new Error('archive manifest has several trees but no repository')
  if (manifest.family !== undefined) assertFamilyManifest({ trees: manifest.trees, family: manifest.family, plain: manifest.repository === null })
}

export async function extractWorkspaceArchive({
  archivePath,
  stage,
}: {
  archivePath: string
  stage: string
}): Promise<WorkspaceManifest> {
  const tar = Bun.spawn(['tar', '-xpf', archivePath, '-C', stage, '--no-same-owner'], {
    stdout: 'ignore',
    stderr: 'pipe',
    stdin: 'ignore',
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  })
  const [stderr, status] = await Promise.all([new Response(tar.stderr).text(), tar.exited])
  if (status !== 0) throw new Error(`could not extract ${archivePath}: ${stderr.trim()}`)
  const manifest = workspaceManifestSchema.parse(JSON.parse(await readFile(join(stage, 'manifest.json'), 'utf8')))
  assertManifest(manifest)
  return manifest
}
