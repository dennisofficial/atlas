import { describe, expect, it } from 'bun:test'

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ENoticeTone, type NoticePort, type NoticePost } from '@dltech/atlas-core'

import { memoryDirectoriesFor } from '../../memory/read-memory'
import { captureMemoryBundle, createMemoryUploader } from '../upload-memory'

const freshDirectory = async (prefix: string): Promise<string> => mkdtemp(join(tmpdir(), prefix))

const writeUnder = async (args: { directory: string; name: string; content: string }): Promise<void> => {
  const path = join(args.directory, args.name)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, args.content, 'utf8')
}

const decode = (bundle: string): Record<string, { content: string; mtime: number }> => {
  const entries = JSON.parse(bundle) as Record<string, { content: string; mtime: number }>
  return Object.fromEntries(
    Object.entries(entries).map(([key, entry]) => [
      key,
      { content: Buffer.from(entry.content, 'base64').toString('utf8'), mtime: entry.mtime },
    ]),
  )
}

const fakeNotice = (): NoticePort & { posts: () => readonly NoticePost[] } => {
  const posts: NoticePost[] = []
  return {
    notify: (post) => posts.push(post),
    posts: () => posts,
  }
}

describe('captureMemoryBundle', () => {
  it('returns undefined when there is nothing to carry', async () => {
    const atlasHome = await freshDirectory('atlas-upload-home-')
    const cwd = await freshDirectory('atlas-upload-cwd-')

    expect(await captureMemoryBundle({ atlasHome, cwd })).toBeUndefined()
  })

  it('carries the flat user memory files with an mtime, but not a nested project directory', async () => {
    const atlasHome = await freshDirectory('atlas-upload-home-')
    const cwd = await freshDirectory('atlas-upload-cwd-')
    await writeUnder({ directory: join(atlasHome, 'memory'), name: 'MEMORY.md', content: '# user memory' })
    await writeUnder({
      directory: join(atlasHome, 'memory'),
      name: 'projects/some-repo/memory/MEMORY.md',
      content: '# nested, not ours to carry here',
    })

    const bundle = await captureMemoryBundle({ atlasHome, cwd })
    if (bundle === undefined) throw new Error('expected a bundle')
    const decoded = decode(bundle)

    expect(Object.keys(decoded)).toEqual(['user/MEMORY.md'])
    expect(decoded['user/MEMORY.md']?.content).toBe('# user memory')
    expect(decoded['user/MEMORY.md']?.mtime).toBeGreaterThan(0)
  })

  it('carries this workspace’s project memory under a bare project/ prefix when the Mac-side directory is unknown', async () => {
    const atlasHome = await freshDirectory('atlas-upload-home-')
    const cwd = await freshDirectory('atlas-upload-cwd-')
    const projectMemory = memoryDirectoriesFor({ atlasHome, repoRoot: cwd }).project
    await writeUnder({ directory: projectMemory, name: 'MEMORY.md', content: '# project memory' })

    const bundle = await captureMemoryBundle({ atlasHome, cwd })
    if (bundle === undefined) throw new Error('expected a bundle')

    expect(decode(bundle)).toEqual({
      'project/MEMORY.md': { content: '# project memory', mtime: expect.any(Number) },
    })
  })

  it('keys project memory by the Mac-side project directory when the workspace spec named one', async () => {
    const atlasHome = await freshDirectory('atlas-upload-home-')
    const cwd = await freshDirectory('atlas-upload-cwd-')
    const projectMemory = memoryDirectoriesFor({ atlasHome, repoRoot: cwd }).project
    await writeUnder({ directory: projectMemory, name: 'MEMORY.md', content: '# project memory' })

    const bundle = await captureMemoryBundle({
      atlasHome,
      cwd,
      projectDirectory: '/Users/dennis/dev/atlas',
    })
    if (bundle === undefined) throw new Error('expected a bundle')

    expect(decode(bundle)).toEqual({
      'project/%2FUsers%2Fdennis%2Fdev%2Fatlas/MEMORY.md': {
        content: '# project memory',
        mtime: expect.any(Number),
      },
    })
  })

  it('captures a non-UTF8 file without corrupting its bytes', async () => {
    const atlasHome = await freshDirectory('atlas-upload-home-')
    const cwd = await freshDirectory('atlas-upload-cwd-')
    const rawBytes = Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02])
    await mkdir(join(atlasHome, 'memory'), { recursive: true })
    await writeFile(join(atlasHome, 'memory', 'icon.png'), rawBytes)

    const bundle = await captureMemoryBundle({ atlasHome, cwd })
    if (bundle === undefined) throw new Error('expected a bundle')
    const entries = JSON.parse(bundle) as Record<string, { content: string; mtime: number }>

    expect(Buffer.from(entries['user/icon.png']?.content ?? '', 'base64')).toEqual(rawBytes)
  })
})

describe('createMemoryUploader', () => {
  it('uploads the captured bundle once and skips a byte-identical re-capture', async () => {
    const atlasHome = await freshDirectory('atlas-upload-home-')
    const cwd = await freshDirectory('atlas-upload-cwd-')
    await writeUnder({ directory: join(atlasHome, 'memory'), name: 'MEMORY.md', content: '# note' })

    const uploaded: string[] = []
    const client = { writeMemoryBundle: async (bundle: string) => void uploaded.push(bundle) }
    const notice = fakeNotice()
    const uploader = createMemoryUploader({ client, atlasHome, cwd, notice })

    await uploader.syncAfterTurn()
    await uploader.syncAfterTurn()

    expect(uploaded).toHaveLength(1)
    expect(notice.posts()).toHaveLength(0)
  })

  it('uploads again once the captured bundle actually changes', async () => {
    const atlasHome = await freshDirectory('atlas-upload-home-')
    const cwd = await freshDirectory('atlas-upload-cwd-')
    await writeUnder({ directory: join(atlasHome, 'memory'), name: 'MEMORY.md', content: '# note' })

    const uploaded: string[] = []
    const client = { writeMemoryBundle: async (bundle: string) => void uploaded.push(bundle) }
    const uploader = createMemoryUploader({ client, atlasHome, cwd, notice: fakeNotice() })

    await uploader.syncAfterTurn()
    await writeUnder({ directory: join(atlasHome, 'memory'), name: 'MEMORY.md', content: '# note, revised' })
    await uploader.syncAfterTurn()

    expect(uploaded).toHaveLength(2)
    expect(uploaded[0]).not.toBe(uploaded[1])
  })

  it('never uploads when there is nothing captured', async () => {
    const atlasHome = await freshDirectory('atlas-upload-home-')
    const cwd = await freshDirectory('atlas-upload-cwd-')

    const uploaded: string[] = []
    const client = { writeMemoryBundle: async (bundle: string) => void uploaded.push(bundle) }
    const uploader = createMemoryUploader({ client, atlasHome, cwd, notice: fakeNotice() })

    await uploader.syncAfterTurn()

    expect(uploaded).toHaveLength(0)
  })

  it('reports a failed upload through the notice port rather than throwing', async () => {
    const atlasHome = await freshDirectory('atlas-upload-home-')
    const cwd = await freshDirectory('atlas-upload-cwd-')
    await writeUnder({ directory: join(atlasHome, 'memory'), name: 'MEMORY.md', content: '# note' })

    const client = {
      writeMemoryBundle: async () => {
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

    const uploaded: string[] = []
    const client = { writeMemoryBundle: async (bundle: string) => void uploaded.push(bundle) }
    const uploader = createMemoryUploader({
      client,
      atlasHome,
      cwd,
      projectDirectory: '/Users/dennis/dev/atlas',
      notice: fakeNotice(),
    })

    await uploader.syncAfterTurn()

    expect(Object.keys(JSON.parse(uploaded[0] ?? '{}'))).toEqual([
      'project/%2FUsers%2Fdennis%2Fdev%2Fatlas/MEMORY.md',
    ])
  })
})
