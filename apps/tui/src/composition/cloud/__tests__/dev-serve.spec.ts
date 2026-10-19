import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EBuildKind } from '../../../build/info'
import { createDevServeResolver, devServeResolverFor, type DevServeDeps } from '../dev-serve'
import { devServeCacheKeyOf, ELinuxServeTarget, type DevServeSource } from '../dev-serve-key'

const scratch: string[] = []

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const cacheRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'dev-serve-cache-'))
  scratch.push(root)
  return root
}

const sourceWith = (diff: string): DevServeSource => ({ head: 'abc', diff, untracked: [] })

const keyOf = (diff: string, target: ELinuxServeTarget = ELinuxServeTarget.X64): string =>
  devServeCacheKeyOf({ source: sourceWith(diff), target })

const sha256Of = (text: string): string => new Bun.CryptoHasher('sha256').update(text).digest('hex')

const pinOfBytes = (text: string): string => `dev-${sha256Of(text).slice(0, 12)}`

const harness = async (overrides: Partial<DevServeDeps> = {}) => {
  const root = await cacheRoot()
  const tree = { diff: '' }
  const builds: string[] = []
  const lines: string[] = []
  const deps: DevServeDeps = {
    repo: async () => '/repo',
    probe: async () => sourceWith(tree.diff),
    build: async ({ outfile }) => {
      builds.push(outfile)
      await writeFile(outfile, `serve for ${tree.diff}`)
    },
    target: ELinuxServeTarget.X64,
    cacheRoot: () => root,
    now: () => 0,
    keep: 3,
    ...overrides,
  }
  const resolve = createDevServeResolver(deps)
  const log = (line: string): void => {
    lines.push(line)
  }
  return { root, tree, builds, lines, resolve, log }
}

describe('createDevServeResolver', () => {
  it('builds once, stores the binary with its sha256 and size, then serves the cache', async () => {
    const { root, builds, lines, resolve, log } = await harness()
    const expected = pinOfBytes('serve for ')
    const inputs = keyOf('').slice(0, 8)

    const first = await resolve({ log })
    const second = await resolve({ log })

    expect(builds).toHaveLength(1)
    expect(first.version).toBe(expected)
    expect(first.version).toMatch(/^dev-[0-9a-f]{12}$/)
    expect(first.path).toBe(join(root, keyOf(''), 'atlas-serve-linux-x64'))
    expect(first.bytes).toBe('serve for '.length)
    expect(first.sha256).toBe(sha256Of('serve for '))
    expect(second).toEqual(first)
    expect(lines).toContain(`building dev serve (inputs ${inputs}) from /repo…`)
    expect(lines.some((line) => line.startsWith(`built dev serve ${expected} (inputs ${inputs}) in `))).toBe(true)
    expect(lines).toContain(`dev serve ${expected} cached (inputs ${inputs})`)
  })

  it('reuses a cache written by an earlier process without building', async () => {
    const first = await harness()
    await first.resolve({})

    const later = await harness({ cacheRoot: () => first.root })
    const binary = await later.resolve({})

    expect(later.builds).toHaveLength(0)
    expect(binary.version).toBe(pinOfBytes('serve for '))
  })

  it('shares one in-flight build between concurrent callers for the same tree', async () => {
    const { builds, resolve } = await harness()

    const [a, b, c] = await Promise.all([resolve({}), resolve({}), resolve({})])

    expect(builds).toHaveLength(1)
    expect(b).toEqual(a)
    expect(c).toEqual(a)
  })

  it('builds again when the tree changes, and different bytes pin a different version', async () => {
    const { root, tree, builds, resolve } = await harness()

    const before = await resolve({})
    tree.diff = '+changed\n'
    const after = await resolve({})

    expect(builds).toHaveLength(2)
    expect(after.version).not.toBe(before.version)
    expect(after.version).toBe(pinOfBytes('serve for +changed\n'))
    expect(after.path).toBe(join(root, keyOf('+changed\n'), 'atlas-serve-linux-x64'))
  })

  it('pins by the binary: different inputs that build identical bytes share one version', async () => {
    const { root, tree, builds, resolve } = await harness({
      build: async ({ outfile }) => {
        builds.push(outfile)
        await writeFile(outfile, 'identical serve')
      },
    })

    const before = await resolve({})
    tree.diff = '+trailing newline\n'
    const after = await resolve({})

    expect(builds).toHaveLength(2)
    expect(after.version).toBe(before.version)
    expect(after.version).toBe(pinOfBytes('identical serve'))
    expect(after.version).toMatch(/^dev-[0-9a-f]{12}$/)
    expect(after.path).not.toBe(before.path)
    expect((await readdir(root)).sort()).toEqual([keyOf(''), keyOf('+trailing newline\n')].sort())
  })

  it('caches the binary under the post-build inputs when the build rewrote the tree', async () => {
    const state = { diff: '' }
    const builds: string[] = []
    const { root, lines, resolve, log } = await harness({
      probe: async () => sourceWith(state.diff),
      build: async ({ outfile }) => {
        builds.push(outfile)
        state.diff = '+generated\n'
        await writeFile(outfile, 'serve')
      },
    })
    const binary = await resolve({ log })
    const again = await resolve({ log })

    expect(binary.version).toBe(pinOfBytes('serve'))
    expect(binary.path).toBe(join(root, keyOf('+generated\n'), 'atlas-serve-linux-x64'))
    expect(lines.some((line) => line.includes('changed the tree'))).toBe(true)
    expect(again).toEqual(binary)
    expect(builds).toHaveLength(1)
  })

  it('surfaces the build failure and leaves no staging behind', async () => {
    const { root, resolve } = await harness({
      build: async () => {
        throw new Error("the dev serve build failed (exit 1): run `bun install --os='*' --cpu='*'`")
      },
    })

    await expect(resolve({})).rejects.toThrow("bun install --os='*' --cpu='*'")
    expect(await readdir(root)).toEqual([])
  })

  it('retries after a failed build rather than caching the failure', async () => {
    const attempts = { count: 0 }
    const { resolve } = await harness({
      build: async ({ outfile }) => {
        attempts.count += 1
        if (attempts.count === 1) throw new Error('flaky')
        await writeFile(outfile, 'serve')
      },
    })

    await expect(resolve({})).rejects.toThrow('flaky')
    expect((await resolve({})).version).toMatch(/^dev-/)
  })

  it('refuses when there is no checkout to build from', async () => {
    const { resolve } = await harness({ repo: async () => null })

    await expect(resolve({})).rejects.toThrow('no source checkout')
  })

  it('keeps only the most recently used builds once the cache outgrows its bound', async () => {
    const clock = { now: Date.UTC(2026, 0, 1) }
    const { root, tree, builds, resolve } = await harness({ keep: 3, now: () => clock.now })
    const use = async (diff: string): Promise<void> => {
      tree.diff = diff
      await resolve({})
      clock.now += 60_000
    }

    await use('a')
    await use('b')
    await use('c')
    await use('a')
    await use('d')

    expect(builds).toHaveLength(4)
    expect((await readdir(root)).sort()).toEqual([keyOf('a'), keyOf('c'), keyOf('d')].sort())
  })

  it('prunes cache dirs left by an older layout like any other', async () => {
    const clock = { now: Date.UTC(2026, 0, 1) }
    const { root, tree, resolve } = await harness({ keep: 1, now: () => clock.now })
    await Bun.write(join(root, 'dev-0123456789ab', 'atlas-serve-linux-x64'), 'old layout')

    tree.diff = 'fresh'
    await resolve({})

    expect(await readdir(root)).toEqual([keyOf('fresh')])
  })
})

describe('devServeResolverFor', () => {
  it('gives a release build no resolver', () => {
    expect(
      devServeResolverFor({ kind: EBuildKind.Release, version: '1.2.3', releaseRepo: null, buildSha: null }),
    ).toBeUndefined()
  })

  it('gives dev and source builds one shared resolver each', () => {
    const dev = devServeResolverFor({ kind: EBuildKind.Dev, repo: '/repo', stamp: 's' })
    const source = devServeResolverFor({ kind: EBuildKind.Source })

    expect(dev).toBeDefined()
    expect(source).toBeDefined()
    expect(devServeResolverFor({ kind: EBuildKind.Dev, repo: '/repo', stamp: 'other' })).toBe(dev)
    expect(devServeResolverFor({ kind: EBuildKind.Source })).toBe(source)
  })
})
