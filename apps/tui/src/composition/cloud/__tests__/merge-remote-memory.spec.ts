import { beforeEach, describe, expect, it } from 'bun:test'

import { access, mkdir, mkdtemp, readFile, realpath, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sanitiseRepoPath } from '@dltech/atlas-core'
import { buildContextArchive, memoryDirectoriesFor } from '@dltech/atlas-harness'

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

const entryFor = (text: string, mtime: number): { content: string; mtime: number } => ({
  content: Buffer.from(text).toString('base64'),
  mtime,
})

const projectKey = (args: { projectDirectory: string; name: string }): string =>
  `project/${encodeURIComponent(args.projectDirectory)}/${args.name}`

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

beforeEach(() => {
  dismissNotice()
})

describe('mergeRemoteMemory', () => {
  it('writes a remote user memory file that has no local counterpart', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const fetchFn = fetchReturning({ 'user/MEMORY.md': entryFor('# from the cloud', 1_000) })

    const result = await mergeRemoteMemory({ session: SESSION, atlasHome, fetchFn })

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

    const result = await mergeRemoteMemory({ session: SESSION, atlasHome, fetchFn })

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

    const result = await mergeRemoteMemory({ session: SESSION, atlasHome, fetchFn })

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

    const result = await mergeRemoteMemory({ session: SESSION, atlasHome, fetchFn })

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

    const result = await mergeRemoteMemory({ session: SESSION, atlasHome, fetchFn })

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

    const result = await mergeRemoteMemory({ session: SESSION, atlasHome, fetchFn })

    expect(result.replaced).toBe(0)
  })

  it('writes a project entry into this repo’s project memory directory when its recorded projectDirectory matches the cwd', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const cwd = await freshDirectory('atlas-merge-cwd-')
    const fetchFn = fetchReturning({
      [projectKey({ projectDirectory: cwd, name: 'MEMORY.md' })]: entryFor('# project note', 1_000),
    })

    const result = await mergeRemoteMemory({ session: SESSION, atlasHome, cwd, fetchFn })
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

    const result = await mergeRemoteMemory({ session: SESSION, atlasHome, cwd, fetchFn })
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

    const result = await mergeRemoteMemory({ session: SESSION, atlasHome, cwd, fetchFn })
    const projectMemory = memoryDirectoriesFor({ atlasHome, repoRoot: cwd }).project

    expect(result.replaced).toBe(0)
    expect(await exists(join(projectMemory, 'MEMORY.md'))).toBe(false)
  })

  it('refuses a key that climbs out of the memory directory it is trusted with', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const fetchFn = fetchReturning({
      'user/../../../../etc/passwd': entryFor('# malicious', 1_000),
    })

    const result = await mergeRemoteMemory({ session: SESSION, atlasHome, fetchFn })

    expect(result.replaced).toBe(0)
  })

  it('posts a warn-tone notice naming how many files it replaced', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const fetchFn = fetchReturning({ 'user/MEMORY.md': entryFor('# from the cloud', 1_000) })

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

const git = (args: { args: string[]; cwd: string }): void => {
  const run = Bun.spawnSync(['git', ...args.args], { cwd: args.cwd })
  if (run.exitCode !== 0) {
    throw new Error(`git ${args.args.join(' ')} failed: ${run.stderr.toString()}`)
  }
}

const initRepoWithOrigin = async (origin: string): Promise<string> => {
  const repo = await realpath(await freshDirectory('atlas-merge-repo-'))
  git({ args: ['init', '--initial-branch=main'], cwd: repo })
  git({ args: ['remote', 'add', 'origin', origin], cwd: repo })
  return repo
}

describe('mergeRemoteMemory with a repo identity', () => {
  it('matches a project entry by repo identity into the identity-keyed directory', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const cwd = await initRepoWithOrigin('git@github.com:org/atlas.git')
    const identity = 'github.com/org/atlas'
    const fetchFn = fetchReturning({
      [`project/${encodeURIComponent(identity)}/notes.md`]: entryFor('# cloud project note', 1_000),
    })

    const result = await mergeRemoteMemory({ session: SESSION, atlasHome, cwd, fetchFn })

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

    const result = await mergeRemoteMemory({ session: SESSION, atlasHome, cwd, fetchFn })

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

    const result = await mergeRemoteMemory({ session: SESSION, atlasHome, cwd, fetchFn })

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

    const result = await mergeRemoteMemory({ session: SESSION, atlasHome, cwd: worktree, fetchFn })

    expect(result.replaced).toBe(1)
    expect(
      await readFile(
        join(atlasHome, 'projects', 'github.com', 'org', 'atlas', 'memory', 'notes.md'),
        'utf8',
      ),
    ).toBe('# recorded from the main checkout')
  })
})

const acceptOf = (init: RequestInit | undefined): string | undefined => {
  const headers = init?.headers as Record<string, string> | undefined
  return headers?.accept
}

/**
 * Answers a real gzip archive to the `Accept: application/gzip` request and 404s every other
 * request — the shape a control plane with only an archive stored actually sends.
 */
const fetchServingArchive = (archive: Buffer): typeof fetch =>
  (async (_input: unknown, init?: RequestInit) => {
    if (acceptOf(init) === 'application/gzip') {
      return new Response(new Uint8Array(archive), { status: 200 })
    }
    return new Response('', { status: 404 })
  }) as typeof fetch

/** 404s the archive request and answers the legacy JSON bundle to everything else. */
const fetchServingLegacyOnly = (
  bundle: Record<string, { content: string; mtime: number }> | null,
): typeof fetch =>
  (async (_input: unknown, init?: RequestInit) => {
    if (acceptOf(init) === 'application/gzip') return new Response('', { status: 404 })
    return new Response(JSON.stringify({ bundle: bundle === null ? null : JSON.stringify(bundle) }), {
      status: 200,
    })
  }) as typeof fetch

describe('mergeRemoteMemory reading a real archive', () => {
  it('untars the archive and applies last-writer-wins by the mtime tar restored', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const staged = await freshDirectory('atlas-merge-staged-')
    await writeFile(join(staged, 'MEMORY.md'), '# from the cloud archive', 'utf8')
    await setMtime(join(staged, 'MEMORY.md'), 5_000)
    const archive = await buildContextArchive({ files: [{ key: 'user/MEMORY.md', path: join(staged, 'MEMORY.md') }] })
    if (archive === undefined) throw new Error('expected an archive')

    const result = await mergeRemoteMemory({
      session: SESSION,
      atlasHome,
      fetchFn: fetchServingArchive(archive),
    })

    expect(result.replaced).toBe(1)
    expect(await readFile(join(atlasHome, 'memory', 'MEMORY.md'), 'utf8')).toBe(
      '# from the cloud archive',
    )
  })

  it('falls back to the legacy JSON bundle when the archive route 404s', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const fetchFn = fetchServingLegacyOnly({ 'user/MEMORY.md': entryFor('# from the legacy route', 1_000) })

    const result = await mergeRemoteMemory({ session: SESSION, atlasHome, fetchFn })

    expect(result.replaced).toBe(1)
    expect(await readFile(join(atlasHome, 'memory', 'MEMORY.md'), 'utf8')).toBe(
      '# from the legacy route',
    )
  })

  it('answers nothing when both the archive and the legacy route report nothing stored', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const fetchFn = fetchServingLegacyOnly(null)

    const result = await mergeRemoteMemory({ session: SESSION, atlasHome, fetchFn })

    expect(result.replaced).toBe(0)
  })
})
