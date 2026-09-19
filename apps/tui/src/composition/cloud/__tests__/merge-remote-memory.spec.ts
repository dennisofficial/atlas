import { beforeEach, describe, expect, it } from 'bun:test'

import { mkdir, mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { memoryDirectoriesFor } from '@dltech/atlas-harness'

import { currentNotices, dismissNotice } from '../../../ui/notice-store'
import { mergeRemoteMemory } from '../merge-remote-memory'

const freshDirectory = async (prefix: string): Promise<string> => mkdtemp(join(tmpdir(), prefix))

const SESSION = { url: 'https://cloud.test', token: 'sess_test' }

const fetchReturning = (bundle: Record<string, { content: string; mtime: number }> | null): typeof fetch =>
  (async (_input: unknown, _init?: RequestInit) =>
    new Response(JSON.stringify({ bundle: bundle === null ? null : JSON.stringify(bundle) }), {
      status: 200,
    })) as typeof fetch

const setMtime = async (path: string, ms: number): Promise<void> => {
  const at = new Date(ms)
  await utimes(path, at, at)
}

beforeEach(() => {
  dismissNotice()
})

describe('mergeRemoteMemory', () => {
  it('writes a remote user memory file that has no local counterpart', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const fetchFn = fetchReturning({ 'user/MEMORY.md': { content: Buffer.from('# from the cloud').toString('base64'), mtime: 1_000 } })

    const result = await mergeRemoteMemory({ session: SESSION, atlasHome, fetchFn })

    expect(result.replaced).toBe(1)
    expect(await readFile(join(atlasHome, 'memory', 'MEMORY.md'), 'utf8')).toBe('# from the cloud')
  })

  it('overwrites a local file that is older than the remote one', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const local = join(atlasHome, 'memory', 'MEMORY.md')
    await mkdir(join(atlasHome, 'memory'), { recursive: true })
    await writeFile(local, '# stale local note', 'utf8')
    await setMtime(local, 1_000)

    const fetchFn = fetchReturning({ 'user/MEMORY.md': { content: Buffer.from('# fresher from the cloud').toString('base64'), mtime: 5_000 } })

    const result = await mergeRemoteMemory({ session: SESSION, atlasHome, fetchFn })

    expect(result.replaced).toBe(1)
    expect(await readFile(local, 'utf8')).toBe('# fresher from the cloud')
  })

  it('leaves a local file alone when it is newer than the remote one', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const local = join(atlasHome, 'memory', 'MEMORY.md')
    await mkdir(join(atlasHome, 'memory'), { recursive: true })
    await writeFile(local, '# newer local note', 'utf8')
    await setMtime(local, 9_000)

    const fetchFn = fetchReturning({ 'user/MEMORY.md': { content: Buffer.from('# stale cloud note').toString('base64'), mtime: 1_000 } })

    const result = await mergeRemoteMemory({ session: SESSION, atlasHome, fetchFn })

    expect(result.replaced).toBe(0)
    expect(await readFile(local, 'utf8')).toBe('# newer local note')
  })

  it('skips project entries when there is no cwd to lift against', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const fetchFn = fetchReturning({
      'project/MEMORY.md': { content: Buffer.from('# project note').toString('base64'), mtime: 1_000 },
    })

    const result = await mergeRemoteMemory({ session: SESSION, atlasHome, fetchFn })

    expect(result.replaced).toBe(0)
  })

  it('writes a project entry into this repo’s project memory directory when a cwd is given', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const cwd = await freshDirectory('atlas-merge-cwd-')
    const fetchFn = fetchReturning({
      'project/MEMORY.md': { content: Buffer.from('# project note').toString('base64'), mtime: 1_000 },
    })

    const result = await mergeRemoteMemory({ session: SESSION, atlasHome, cwd, fetchFn })
    const projectMemory = memoryDirectoriesFor({ atlasHome, repoRoot: cwd }).project

    expect(result.replaced).toBe(1)
    expect(await readFile(join(projectMemory, 'MEMORY.md'), 'utf8')).toBe('# project note')
  })

  it('posts a warn-tone notice naming how many files it replaced', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const fetchFn = fetchReturning({ 'user/MEMORY.md': { content: Buffer.from('# from the cloud').toString('base64'), mtime: 1_000 } })

    await mergeRemoteMemory({ session: SESSION, atlasHome, fetchFn })

    const notice = currentNotices().find((entry) => entry.key === 'remote-memory-merge')
    expect(notice).toBeDefined()
    expect(notice?.text).toContain('1 file')
  })

  it('posts nothing when the remote holds nothing newer', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const fetchFn = fetchReturning(null)

    await mergeRemoteMemory({ session: SESSION, atlasHome, fetchFn })

    expect(currentNotices().find((entry) => entry.key === 'remote-memory-merge')).toBeUndefined()
  })
})
