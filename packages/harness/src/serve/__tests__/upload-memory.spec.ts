import { describe, expect, it } from 'bun:test'

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ENoticeTone, type NoticePort, type NoticePost } from '@dltech/atlas-core'

import { extractContextArchive } from '../../cloud/context-archive'
import { memoryDirectoriesFor } from '../../memory/read-memory'
import {
  captureMemoryArchive,
  createMemoryUploader,
  memoryManifestOf,
  walkMemorySet,
} from '../upload-memory'

const freshDirectory = async (prefix: string): Promise<string> => mkdtemp(join(tmpdir(), prefix))

const writeUnder = async (args: { directory: string; name: string; content: string }): Promise<void> => {
  const path = join(args.directory, args.name)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, args.content, 'utf8')
}

const decode = async (archive: Buffer): Promise<Record<string, string>> => {
  const extracted = await extractContextArchive({ archive })
  try {
    const decoded: Record<string, string> = {}
    for (const entry of extracted.entries) {
      decoded[entry.key] = (await readFile(entry.path)).toString('utf8')
    }
    return decoded
  } finally {
    await extracted.cleanup()
  }
}

const fakeNotice = (): NoticePort & { posts: () => readonly NoticePost[] } => {
  const posts: NoticePost[] = []
  return {
    notify: (post) => posts.push(post),
    posts: () => posts,
  }
}

describe('walkMemorySet', () => {
  it('returns nothing when there is nothing to carry', async () => {
    const atlasHome = await freshDirectory('atlas-upload-home-')
    const cwd = await freshDirectory('atlas-upload-cwd-')

    expect(await walkMemorySet({ atlasHome, cwd })).toEqual([])
  })

  it('carries the flat user memory files with an mtime and size, but not a nested project directory', async () => {
    const atlasHome = await freshDirectory('atlas-upload-home-')
    const cwd = await freshDirectory('atlas-upload-cwd-')
    await writeUnder({ directory: join(atlasHome, 'memory'), name: 'MEMORY.md', content: '# user memory' })
    await writeUnder({
      directory: join(atlasHome, 'memory'),
      name: 'projects/some-repo/memory/MEMORY.md',
      content: '# nested, not ours to carry here',
    })

    const entries = await walkMemorySet({ atlasHome, cwd })

    expect(entries.map((entry) => entry.key)).toEqual(['user/MEMORY.md'])
    expect(entries[0]?.mtimeMs).toBeGreaterThan(0)
    expect(entries[0]?.size).toBeGreaterThan(0)
  })

  it('carries this workspace’s project memory under a bare project/ prefix when the Mac-side directory is unknown', async () => {
    const atlasHome = await freshDirectory('atlas-upload-home-')
    const cwd = await freshDirectory('atlas-upload-cwd-')
    const projectMemory = memoryDirectoriesFor({ atlasHome, repoRoot: cwd }).project
    await writeUnder({ directory: projectMemory, name: 'MEMORY.md', content: '# project memory' })

    const entries = await walkMemorySet({ atlasHome, cwd })

    expect(entries.map((entry) => entry.key)).toEqual(['project/MEMORY.md'])
  })

  it('keys project memory by the Mac-side project directory when the workspace spec named one', async () => {
    const atlasHome = await freshDirectory('atlas-upload-home-')
    const cwd = await freshDirectory('atlas-upload-cwd-')
    const projectMemory = memoryDirectoriesFor({ atlasHome, repoRoot: cwd }).project
    await writeUnder({ directory: projectMemory, name: 'MEMORY.md', content: '# project memory' })

    const entries = await walkMemorySet({ atlasHome, cwd, projectDirectory: '/Users/dennis/dev/atlas' })

    expect(entries.map((entry) => entry.key)).toEqual([
      'project/%2FUsers%2Fdennis%2Fdev%2Fatlas/MEMORY.md',
    ])
  })
})

describe('memoryManifestOf', () => {
  const entryA = { key: 'user/a.md', path: '/a', mtimeMs: 1, size: 2 }
  const entryB = { key: 'user/b.md', path: '/b', mtimeMs: 3, size: 4 }

  it('is stable for the same walked set regardless of input order', () => {
    expect(memoryManifestOf([entryA, entryB])).toBe(memoryManifestOf([entryB, entryA]))
  })

  it('changes when the mtime of an entry changes', () => {
    expect(memoryManifestOf([entryA])).not.toBe(memoryManifestOf([{ ...entryA, mtimeMs: 2 }]))
  })

  it('changes when the size of an entry changes', () => {
    expect(memoryManifestOf([entryA])).not.toBe(memoryManifestOf([{ ...entryA, size: 9 }]))
  })
})

describe('captureMemoryArchive', () => {
  it('archives the same content and mtime walkMemorySet reported', async () => {
    const atlasHome = await freshDirectory('atlas-upload-home-')
    const cwd = await freshDirectory('atlas-upload-cwd-')
    await writeUnder({ directory: join(atlasHome, 'memory'), name: 'MEMORY.md', content: '# user memory' })

    const entries = await walkMemorySet({ atlasHome, cwd })
    const archive = await captureMemoryArchive({ entries })
    if (archive === undefined) throw new Error('expected an archive')

    expect(await decode(archive)).toEqual({ 'user/MEMORY.md': '# user memory' })
  })

  it('captures a non-UTF8 file without corrupting its bytes', async () => {
    const atlasHome = await freshDirectory('atlas-upload-home-')
    const cwd = await freshDirectory('atlas-upload-cwd-')
    const rawBytes = Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02])
    await mkdir(join(atlasHome, 'memory'), { recursive: true })
    await writeFile(join(atlasHome, 'memory', 'icon.png'), rawBytes)

    const entries = await walkMemorySet({ atlasHome, cwd })
    const archive = await captureMemoryArchive({ entries })
    if (archive === undefined) throw new Error('expected an archive')

    const extracted = await extractContextArchive({ archive })
    try {
      const entry = extracted.entries.find((candidate) => candidate.key === 'user/icon.png')
      if (entry === undefined) throw new Error('expected user/icon.png in the archive')
      expect(await readFile(entry.path)).toEqual(rawBytes)
    } finally {
      await extracted.cleanup()
    }
  })

  it('returns undefined for an empty walked set', async () => {
    expect(await captureMemoryArchive({ entries: [] })).toBeUndefined()
  })
})

describe('createMemoryUploader', () => {
  it('uploads the captured archive once and skips a re-capture whose manifest has not changed', async () => {
    const atlasHome = await freshDirectory('atlas-upload-home-')
    const cwd = await freshDirectory('atlas-upload-cwd-')
    await writeUnder({ directory: join(atlasHome, 'memory'), name: 'MEMORY.md', content: '# note' })

    const uploaded: Buffer[] = []
    const client = { writeMemoryArchive: async (archive: Buffer) => void uploaded.push(archive) }
    const notice = fakeNotice()
    const uploader = createMemoryUploader({ client, atlasHome, cwd, notice })

    await uploader.syncAfterTurn()
    await uploader.syncAfterTurn()

    expect(uploaded).toHaveLength(1)
    expect(notice.posts()).toHaveLength(0)
  })

  it('uploads again once the walked set actually changes', async () => {
    const atlasHome = await freshDirectory('atlas-upload-home-')
    const cwd = await freshDirectory('atlas-upload-cwd-')
    await writeUnder({ directory: join(atlasHome, 'memory'), name: 'MEMORY.md', content: '# note' })

    const uploaded: Buffer[] = []
    const client = { writeMemoryArchive: async (archive: Buffer) => void uploaded.push(archive) }
    const uploader = createMemoryUploader({ client, atlasHome, cwd, notice: fakeNotice() })

    await uploader.syncAfterTurn()
    await writeUnder({ directory: join(atlasHome, 'memory'), name: 'MEMORY.md', content: '# note, revised, and longer' })
    await uploader.syncAfterTurn()

    expect(uploaded).toHaveLength(2)
    expect(await decode(uploaded[1] as Buffer)).toEqual({
      'user/MEMORY.md': '# note, revised, and longer',
    })
  })

  it('never uploads when there is nothing captured', async () => {
    const atlasHome = await freshDirectory('atlas-upload-home-')
    const cwd = await freshDirectory('atlas-upload-cwd-')

    const uploaded: Buffer[] = []
    const client = { writeMemoryArchive: async (archive: Buffer) => void uploaded.push(archive) }
    const uploader = createMemoryUploader({ client, atlasHome, cwd, notice: fakeNotice() })

    await uploader.syncAfterTurn()

    expect(uploaded).toHaveLength(0)
  })

  it('reports a failed upload through the notice port rather than throwing', async () => {
    const atlasHome = await freshDirectory('atlas-upload-home-')
    const cwd = await freshDirectory('atlas-upload-cwd-')
    await writeUnder({ directory: join(atlasHome, 'memory'), name: 'MEMORY.md', content: '# note' })

    const client = {
      writeMemoryArchive: async () => {
        throw new Error('the control plane said no')
      },
    }
    const notice = fakeNotice()
    const uploader = createMemoryUploader({ client, atlasHome, cwd, notice })

    await uploader.syncAfterTurn()

    expect(notice.posts()).toHaveLength(1)
    expect(notice.posts()[0]?.tone).toBe(ENoticeTone.Warn)
    expect(notice.posts()[0]?.text).toContain('the control plane said no')
  })

  it('carries the projectDirectory through to the keys it uploads', async () => {
    const atlasHome = await freshDirectory('atlas-upload-home-')
    const cwd = await freshDirectory('atlas-upload-cwd-')
    const projectMemory = memoryDirectoriesFor({ atlasHome, repoRoot: cwd }).project
    await writeUnder({ directory: projectMemory, name: 'MEMORY.md', content: '# project memory' })

    const uploaded: Buffer[] = []
    const client = { writeMemoryArchive: async (archive: Buffer) => void uploaded.push(archive) }
    const uploader = createMemoryUploader({
      client,
      atlasHome,
      cwd,
      projectDirectory: '/Users/dennis/dev/atlas',
      notice: fakeNotice(),
    })

    await uploader.syncAfterTurn()

    expect(Object.keys(await decode(uploaded[0] as Buffer))).toEqual([
      'project/%2FUsers%2Fdennis%2Fdev%2Fatlas/MEMORY.md',
    ])
  })
})
