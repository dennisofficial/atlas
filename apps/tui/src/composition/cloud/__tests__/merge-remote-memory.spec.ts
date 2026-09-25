import { describe, expect, it } from 'bun:test'

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ENoticeTone } from '@dltech/atlas-core'
import { memoryDirectoriesFor, mergeRemoteMemory } from '@dltech/atlas-harness'

import {
  entryFor,
  exists,
  fetchReturning,
  freshDirectory,
  projectKey,
  recordingNotices,
  SESSION,
  setMtime,
} from './merge-memory-fixture'

describe('mergeRemoteMemory', () => {
  it('writes a remote user memory file that has no local counterpart', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const fetchFn = fetchReturning({ 'user/MEMORY.md': entryFor('# from the cloud', 1_000) })

    const result = await mergeRemoteMemory({
      session: SESSION,
      clientVersion: 'atlas/test',
      notice: recordingNotices().port,
      atlasHome,
      fetchFn,
    })

    expect(result.replaced).toBe(1)
    expect(await readFile(join(atlasHome, 'memory', 'MEMORY.md'), 'utf8')).toBe('# from the cloud')
  })

  it('overwrites a local file that is older than the remote one', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const local = join(atlasHome, 'memory', 'notes.md')
    await mkdir(join(atlasHome, 'memory'), { recursive: true })
    await writeFile(local, '# stale local note', 'utf8')
    await setMtime(local, 1_000)

    const fetchFn = fetchReturning({ 'user/notes.md': entryFor('# fresher from the cloud', 5_000) })

    const result = await mergeRemoteMemory({
      session: SESSION,
      clientVersion: 'atlas/test',
      notice: recordingNotices().port,
      atlasHome,
      fetchFn,
    })

    expect(result.replaced).toBe(1)
    expect(await readFile(local, 'utf8')).toBe('# fresher from the cloud')
  })

  it('merges the MEMORY.md index line-union with dedupe, whichever side is newer', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const local = join(atlasHome, 'memory', 'MEMORY.md')
    await mkdir(join(atlasHome, 'memory'), { recursive: true })
    await writeFile(local, '- one\n- two\n', 'utf8')
    await setMtime(local, 9_000)

    const fetchFn = fetchReturning({
      'user/MEMORY.md': entryFor('- two\n- three\n', 1_000),
    })

    const result = await mergeRemoteMemory({
      session: SESSION,
      clientVersion: 'atlas/test',
      notice: recordingNotices().port,
      atlasHome,
      fetchFn,
    })

    expect(result.replaced).toBe(1)
    expect(result.conflicts).toEqual([])
    expect(await readFile(local, 'utf8')).toBe('- one\n- two\n- three\n')
  })

  it('keeps the local copy on a conflict and returns the cloud version rather than dropping it', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const local = join(atlasHome, 'memory', 'notes.md')
    await mkdir(join(atlasHome, 'memory'), { recursive: true })
    await writeFile(local, '# newer local note', 'utf8')
    await setMtime(local, 9_000)

    const fetchFn = fetchReturning({ 'user/notes.md': entryFor('# stale cloud note', 1_000) })

    const result = await mergeRemoteMemory({
      session: SESSION,
      clientVersion: 'atlas/test',
      notice: recordingNotices().port,
      atlasHome,
      fetchFn,
    })

    expect(result.replaced).toBe(0)
    expect(result.conflicts).toEqual([{ key: 'user/notes.md', text: '# stale cloud note' }])
    expect(await readFile(local, 'utf8')).toBe('# newer local note')
  })

  it('stays quiet when the newer local copy holds what the cloud holds', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const local = join(atlasHome, 'memory', 'notes.md')
    await mkdir(join(atlasHome, 'memory'), { recursive: true })
    await writeFile(local, '# same note', 'utf8')
    await setMtime(local, 9_000)

    const fetchFn = fetchReturning({ 'user/notes.md': entryFor('# same note', 1_000) })

    const result = await mergeRemoteMemory({
      session: SESSION,
      clientVersion: 'atlas/test',
      notice: recordingNotices().port,
      atlasHome,
      fetchFn,
    })

    expect(result.replaced).toBe(0)
    expect(result.conflicts).toEqual([])
  })

  it('skips project entries when there is no cwd to lift against', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const fetchFn = fetchReturning({
      [projectKey({ projectDirectory: '/Users/dennis/dev/atlas', name: 'MEMORY.md' })]: entryFor(
        '# project note',
        1_000,
      ),
    })

    const result = await mergeRemoteMemory({
      session: SESSION,
      clientVersion: 'atlas/test',
      notice: recordingNotices().port,
      atlasHome,
      fetchFn,
    })

    expect(result.replaced).toBe(0)
  })

  it('writes a project entry into this repo’s project memory directory when its recorded projectDirectory matches the cwd', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const cwd = await freshDirectory('atlas-merge-cwd-')
    const fetchFn = fetchReturning({
      [projectKey({ projectDirectory: cwd, name: 'MEMORY.md' })]: entryFor('# project note', 1_000),
    })

    const result = await mergeRemoteMemory({
      session: SESSION,
      clientVersion: 'atlas/test',
      notice: recordingNotices().port,
      atlasHome,
      cwd,
      fetchFn,
    })
    const projectMemory = memoryDirectoriesFor({ atlasHome, repoRoot: cwd }).project

    expect(result.replaced).toBe(1)
    expect(await readFile(join(projectMemory, 'MEMORY.md'), 'utf8')).toBe('# project note')
  })

  it('skips a project entry recorded for a different repo, rather than pollute whichever one is open', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const cwd = await freshDirectory('atlas-merge-cwd-')
    const otherRepo = await freshDirectory('atlas-merge-other-repo-')
    const fetchFn = fetchReturning({
      [projectKey({ projectDirectory: otherRepo, name: 'MEMORY.md' })]: entryFor(
        '# someone else’s project note',
        1_000,
      ),
    })

    const result = await mergeRemoteMemory({
      session: SESSION,
      clientVersion: 'atlas/test',
      notice: recordingNotices().port,
      atlasHome,
      cwd,
      fetchFn,
    })
    const projectMemory = memoryDirectoriesFor({ atlasHome, repoRoot: cwd }).project

    expect(result.replaced).toBe(0)
    expect(await exists(join(projectMemory, 'MEMORY.md'))).toBe(false)
  })

  it('skips a legacy project entry with no recorded repo, even when a cwd is given', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const cwd = await freshDirectory('atlas-merge-cwd-')
    const fetchFn = fetchReturning({
      'project/MEMORY.md': entryFor('# ambiguous, could be any repo', 1_000),
    })

    const result = await mergeRemoteMemory({
      session: SESSION,
      clientVersion: 'atlas/test',
      notice: recordingNotices().port,
      atlasHome,
      cwd,
      fetchFn,
    })
    const projectMemory = memoryDirectoriesFor({ atlasHome, repoRoot: cwd }).project

    expect(result.replaced).toBe(0)
    expect(await exists(join(projectMemory, 'MEMORY.md'))).toBe(false)
  })

  it('refuses a key that climbs out of the memory directory it is trusted with', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const fetchFn = fetchReturning({
      'user/../../../../etc/passwd': entryFor('# malicious', 1_000),
    })

    const result = await mergeRemoteMemory({
      session: SESSION,
      clientVersion: 'atlas/test',
      notice: recordingNotices().port,
      atlasHome,
      fetchFn,
    })

    expect(result.replaced).toBe(0)
  })

  it('posts a warn-tone notice naming how many files it replaced', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const fetchFn = fetchReturning({ 'user/MEMORY.md': entryFor('# from the cloud', 1_000) })
    const { posts, port } = recordingNotices()

    await mergeRemoteMemory({
      session: SESSION,
      clientVersion: 'atlas/test',
      notice: port,
      atlasHome,
      fetchFn,
    })

    const notice = posts.find((entry) => entry.key === 'remote-memory-merge')
    expect(notice).toBeDefined()
    expect(notice?.tone).toBe(ENoticeTone.Warn)
    expect(notice?.text).toContain('1 file')
  })

  it('posts nothing when the remote holds nothing newer', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const fetchFn = fetchReturning(null)
    const { posts, port } = recordingNotices()

    await mergeRemoteMemory({
      session: SESSION,
      clientVersion: 'atlas/test',
      notice: port,
      atlasHome,
      fetchFn,
    })

    expect(posts.find((entry) => entry.key === 'remote-memory-merge')).toBeUndefined()
  })
})
