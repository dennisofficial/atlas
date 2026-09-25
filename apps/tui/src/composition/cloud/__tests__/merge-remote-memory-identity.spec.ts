import { describe, expect, it } from 'bun:test'

import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { sanitiseRepoPath } from '@dltech/atlas-core'

import { mergeRemoteMemory } from '@dltech/atlas-harness'

import {
  entryFor,
  exists,
  fetchReturning,
  freshDirectory,
  git,
  initRepoWithOrigin,
  projectKey,
  recordingNotices,
  SESSION,
} from './merge-memory-fixture'

describe('mergeRemoteMemory with a repo identity', () => {
  it('matches a project entry by repo identity into the identity-keyed directory', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const cwd = await initRepoWithOrigin('git@github.com:org/atlas.git')
    const identity = 'github.com/org/atlas'
    const fetchFn = fetchReturning({
      [`project/${encodeURIComponent(identity)}/notes.md`]: entryFor('# cloud project note', 1_000),
    })

    const result = await mergeRemoteMemory({
      session: SESSION,
      clientVersion: 'atlas/test',
      notice: recordingNotices().port,
      atlasHome,
      cwd,
      fetchFn,
    })

    expect(result.replaced).toBe(1)
    expect(
      await readFile(
        join(atlasHome, 'projects', 'github.com', 'org', 'atlas', 'memory', 'notes.md'),
        'utf8',
      ),
    ).toBe('# cloud project note')
  })

  it('skips an identity entry that names a different repo', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const cwd = await initRepoWithOrigin('git@github.com:org/atlas.git')
    const fetchFn = fetchReturning({
      [`project/${encodeURIComponent('github.com/someone/else')}/notes.md`]: entryFor(
        '# not this repo',
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

    expect(result.replaced).toBe(0)
    expect(await exists(join(atlasHome, 'projects'))).toBe(false)
  })

  it('adopts the legacy path-keyed directory while merging, so old notes are not forked', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const cwd = await initRepoWithOrigin('git@github.com:org/atlas.git')
    const legacy = join(atlasHome, 'projects', sanitiseRepoPath(cwd), 'memory')
    await mkdir(legacy, { recursive: true })
    await writeFile(join(legacy, 'old.md'), '# pre-identity note', 'utf8')

    const fetchFn = fetchReturning({
      [`project/${encodeURIComponent('github.com/org/atlas')}/new.md`]: entryFor('# cloud note', 1_000),
    })

    const result = await mergeRemoteMemory({
      session: SESSION,
      clientVersion: 'atlas/test',
      notice: recordingNotices().port,
      atlasHome,
      cwd,
      fetchFn,
    })

    const identityMemory = join(atlasHome, 'projects', 'github.com', 'org', 'atlas', 'memory')
    expect(result.replaced).toBe(1)
    expect(await readFile(join(identityMemory, 'old.md'), 'utf8')).toBe('# pre-identity note')
    expect(await readFile(join(identityMemory, 'new.md'), 'utf8')).toBe('# cloud note')
    expect(await exists(join(legacy, 'old.md'))).toBe(false)
  })

  it('matches a legacy path-keyed entry recorded against a sibling worktree of this repo', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const main = await initRepoWithOrigin('git@github.com:org/atlas.git')
    await writeFile(join(main, 'README.md'), 'hi', 'utf8')
    git({ args: ['add', 'README.md'], cwd: main })
    git({ args: ['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-m', 'init'], cwd: main })
    const worktree = join(await realpath(await freshDirectory('atlas-merge-wt-parent-')), 'wt')
    git({ args: ['worktree', 'add', worktree], cwd: main })

    const fetchFn = fetchReturning({
      [projectKey({ projectDirectory: main, name: 'notes.md' })]: entryFor(
        '# recorded from the main checkout',
        1_000,
      ),
    })

    const result = await mergeRemoteMemory({
      session: SESSION,
      clientVersion: 'atlas/test',
      notice: recordingNotices().port,
      atlasHome,
      cwd: worktree,
      fetchFn,
    })

    expect(result.replaced).toBe(1)
    expect(
      await readFile(
        join(atlasHome, 'projects', 'github.com', 'org', 'atlas', 'memory', 'notes.md'),
        'utf8',
      ),
    ).toBe('# recorded from the main checkout')
  })
})
