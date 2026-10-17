import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  devServeCacheKeyOf,
  devServeKeyOf,
  devServePinOf,
  probeDevServeSource,
  type DevServeSource,
} from '../dev-serve-key'

const BASE: DevServeSource = {
  head: 'abc123',
  diff: '',
  untracked: [{ path: 'a.ts', sha256: '11' }],
}

const scratch: string[] = []

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const run = async (args: { cwd: string; argv: readonly string[] }): Promise<void> => {
  const proc = Bun.spawn(['git', ...args.argv], { cwd: args.cwd, stdout: 'ignore', stderr: 'ignore' })
  if ((await proc.exited) !== 0) throw new Error(`git ${args.argv.join(' ')} failed`)
}

const gitRepo = async (): Promise<string> => {
  const repo = await mkdtemp(join(tmpdir(), 'dev-serve-key-'))
  scratch.push(repo)
  await run({ cwd: repo, argv: ['init', '-q'] })
  await writeFile(join(repo, '.gitignore'), 'ignored.txt\n')
  await writeFile(join(repo, 'tracked.ts'), 'one\n')
  await run({ cwd: repo, argv: ['add', '.'] })
  await run({
    cwd: repo,
    argv: ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'init'],
  })
  return repo
}

const keyOfRepo = async (repo: string): Promise<string> => {
  const source = await probeDevServeSource({ repo })
  if (source === null) throw new Error('probe failed')
  return devServeCacheKeyOf(source)
}

describe('devServeKeyOf', () => {
  it('is stable over the same inputs, whatever order the untracked files were listed in', () => {
    const two = { ...BASE, untracked: [{ path: 'b.ts', sha256: '22' }, { path: 'a.ts', sha256: '11' }] }
    const reversed = { ...two, untracked: [...two.untracked].reverse() }

    expect(devServeKeyOf(BASE)).toBe(devServeKeyOf({ ...BASE }))
    expect(devServeKeyOf(two)).toBe(devServeKeyOf(reversed))
  })

  it('moves when the commit, the tracked diff, or an untracked file moves', () => {
    const key = devServeKeyOf(BASE)

    expect(devServeKeyOf({ ...BASE, head: 'def456' })).not.toBe(key)
    expect(devServeKeyOf({ ...BASE, diff: '+line\n' })).not.toBe(key)
    expect(devServeKeyOf({ ...BASE, untracked: [{ path: 'a.ts', sha256: '12' }] })).not.toBe(key)
    expect(devServeKeyOf({ ...BASE, untracked: [{ path: 'b.ts', sha256: '11' }] })).not.toBe(key)
    expect(devServeKeyOf({ ...BASE, untracked: [] })).not.toBe(key)
  })

  it('caches under the first sixteen hex of the input key', () => {
    expect(devServeCacheKeyOf(BASE)).toMatch(/^[0-9a-f]{16}$/)
    expect(devServeCacheKeyOf(BASE)).toBe(devServeKeyOf(BASE).slice(0, 16))
  })
})

describe('devServePinOf', () => {
  it('pins as dev- plus twelve hex of the binary sha256', () => {
    const sha = new Bun.CryptoHasher('sha256').update('serve').digest('hex')

    expect(devServePinOf(sha)).toMatch(/^dev-[0-9a-f]{12}$/)
    expect(devServePinOf(sha)).toBe(`dev-${sha.slice(0, 12)}`)
  })
})

describe('probeDevServeSource', () => {
  it('keys an unchanged checkout the same way twice', async () => {
    const repo = await gitRepo()

    expect(await keyOfRepo(repo)).toBe(await keyOfRepo(repo))
  })

  it('moves with tracked edits and untracked content, but not with ignored files', async () => {
    const repo = await gitRepo()
    const clean = await keyOfRepo(repo)

    await writeFile(join(repo, 'ignored.txt'), 'noise')
    expect(await keyOfRepo(repo)).toBe(clean)

    await writeFile(join(repo, 'tracked.ts'), 'two\n')
    const edited = await keyOfRepo(repo)
    expect(edited).not.toBe(clean)

    await writeFile(join(repo, 'new.ts'), 'first')
    const untracked = await keyOfRepo(repo)
    expect(untracked).not.toBe(edited)

    await writeFile(join(repo, 'new.ts'), 'second')
    expect(await keyOfRepo(repo)).not.toBe(untracked)
  })

  it('reads nothing outside a git checkout', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'dev-serve-plain-'))
    scratch.push(plain)

    expect(await probeDevServeSource({ repo: plain })).toBeNull()
  })
})
