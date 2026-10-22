import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  devServeCacheKeyOf,
  devServeKeyOf,
  devServePinOf,
  ELinuxServeTarget,
  probeDevServeSource,
  type DevServeSource,
} from '../dev-serve-key'

const BASE: DevServeSource = {
  head: 'abc123',
  diff: '',
  untracked: [{ path: 'a.ts', sha256: '11' }],
}

const X64 = ELinuxServeTarget.X64

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
  return devServeCacheKeyOf({ source, target: ELinuxServeTarget.X64 })
}

describe('devServeKeyOf', () => {
  it('is stable over the same inputs, whatever order the untracked files were listed in', () => {
    const two = { ...BASE, untracked: [{ path: 'b.ts', sha256: '22' }, { path: 'a.ts', sha256: '11' }] }
    const reversed = { ...two, untracked: [...two.untracked].reverse() }

    expect(devServeKeyOf({ source: BASE, target: X64 })).toBe(devServeKeyOf({ source: { ...BASE }, target: X64 }))
    expect(devServeKeyOf({ source: two, target: X64 })).toBe(devServeKeyOf({ source: reversed, target: X64 }))
  })

  it('moves when the commit, the tracked diff, or an untracked file moves', () => {
    const key = devServeKeyOf({ source: BASE, target: X64 })

    expect(devServeKeyOf({ source: { ...BASE, head: 'def456' }, target: X64 })).not.toBe(key)
    expect(devServeKeyOf({ source: { ...BASE, diff: '+line\n' }, target: X64 })).not.toBe(key)
    expect(devServeKeyOf({ source: { ...BASE, untracked: [{ path: 'a.ts', sha256: '12' }] }, target: X64 })).not.toBe(key)
    expect(devServeKeyOf({ source: { ...BASE, untracked: [{ path: 'b.ts', sha256: '11' }] }, target: X64 })).not.toBe(key)
    expect(devServeKeyOf({ source: { ...BASE, untracked: [] }, target: X64 })).not.toBe(key)
  })

  it('keeps the linux-x64 key byte-identical to the key hashed before the target became a parameter', () => {
    const source: DevServeSource = { head: 'abc123', diff: '+line\n', untracked: [{ path: 'a.ts', sha256: '11' }] }

    expect(devServeKeyOf({ source, target: X64 })).toBe(
      '9e0396e9a50e14a31987d1109bda97c6e444738d585bccc4ec19a2499480bdb0',
    )
  })

  it('keys linux-arm64 differently from linux-x64 for the same source', () => {
    const arm64 = devServeKeyOf({ source: BASE, target: ELinuxServeTarget.Arm64 })

    expect(arm64).not.toBe(devServeKeyOf({ source: BASE, target: X64 }))
    expect(devServeCacheKeyOf({ source: BASE, target: ELinuxServeTarget.Arm64 })).toBe(arm64.slice(0, 16))
  })

  it('caches under the first sixteen hex of the input key', () => {
    expect(devServeCacheKeyOf({ source: BASE, target: X64 })).toMatch(/^[0-9a-f]{16}$/)
    expect(devServeCacheKeyOf({ source: BASE, target: X64 })).toBe(devServeKeyOf({ source: BASE, target: X64 }).slice(0, 16))
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
