import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EChangeScope, EChangeStatus } from '@dltech/atlas-wire'

import { runGit } from '../../workspace/run-git'
import { LocalGitChanges } from '../local-git-changes'

let root = ''

const git = async (...args: string[]) => {
  const run = await runGit({
    args: ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
    cwd: root,
  })
  if (!run.ok) throw new Error(run.stderr)
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'atlas-changes-'))
  await git('init', '-q', '-b', 'main')
  writeFileSync(join(root, 'a.txt'), 'one\ntwo\n')
  await git('add', '.')
  await git('commit', '-q', '-m', 'first')
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('LocalGitChanges', () => {
  it('reports uncommitted edits and untracked files against HEAD', async () => {
    writeFileSync(join(root, 'a.txt'), 'one\nthree\n')
    writeFileSync(join(root, 'new.txt'), 'fresh\n')

    const reply = await new LocalGitChanges({ root }).read({ scope: EChangeScope.Uncommitted })

    expect(
      reply.files.map((file) => [file.path, file.status, file.additions, file.deletions]),
    ).toEqual([
      ['a.txt', EChangeStatus.Modified, 1, 1],
      ['new.txt', EChangeStatus.Added, 1, 0],
    ])
  })

  it('reports the last commit against its parent, or an empty tree for the root commit', async () => {
    const changes = new LocalGitChanges({ root })
    const first = await changes.read({ scope: EChangeScope.LastCommit })
    expect(first.base).toBeNull()
    expect(first.files.map((file) => file.status)).toEqual([EChangeStatus.Added])

    writeFileSync(join(root, 'a.txt'), 'one\ntwo\nthree\n')
    await git('commit', '-q', '-am', 'second')
    const second = await changes.read({ scope: EChangeScope.LastCommit })
    expect(second.base).not.toBeNull()
    expect(second.files[0]).toMatchObject({ path: 'a.txt', additions: 1, deletions: 0 })
  })

  it('reports everything since the branch point for the all scope', async () => {
    await git('checkout', '-q', '-b', 'feature')
    writeFileSync(join(root, 'b.txt'), 'b\n')
    await git('add', '.')
    await git('commit', '-q', '-m', 'on feature')
    writeFileSync(join(root, 'a.txt'), 'changed\n')

    const reply = await new LocalGitChanges({ root }).read({ scope: EChangeScope.All })

    expect(reply.files.map((file) => file.path)).toEqual(['a.txt', 'b.txt'])
  })

  it('answers empty outside a repository', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'atlas-nogit-'))
    try {
      const reply = await new LocalGitChanges({ root: bare }).read({ scope: EChangeScope.All })
      expect(reply.files).toEqual([])
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  })

  it('lists gitignored paths, collapsing a fully ignored folder to its directory', async () => {
    writeFileSync(join(root, '.gitignore'), 'build/\n*.log\n')
    mkdirSync(join(root, 'build'), { recursive: true })
    writeFileSync(join(root, 'build', 'out.js'), 'x\n')
    writeFileSync(join(root, 'debug.log'), 'x\n')

    const reply = await new LocalGitChanges({ root }).read({ scope: EChangeScope.Uncommitted })

    expect([...reply.ignored].sort()).toEqual(['build', 'debug.log'])
  })
})
