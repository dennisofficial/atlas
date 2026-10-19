import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EBuildKind } from '../../../build/info'
import { createDevServeResolver, devServeBuildArgvOf, devServeResolverFor } from '../dev-serve'
import { devServeBinaryNameOf } from '../dev-serve-cache'
import { devServeCacheKeyOf, ELinuxServeTarget, type DevServeSource } from '../dev-serve-key'

const scratch: string[] = []

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const cacheRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'dev-serve-target-'))
  scratch.push(root)
  return root
}

const sourceWith = (diff: string): DevServeSource => ({ head: 'abc', diff, untracked: [] })

const keyOf = (diff: string, target: ELinuxServeTarget): string =>
  devServeCacheKeyOf({ source: sourceWith(diff), target })

describe('createDevServeResolver for linux-arm64', () => {
  it('builds with the arm64 target, stores atlas-serve-linux-arm64, and caches apart from x64', async () => {
    const root = await cacheRoot()
    const targets: ELinuxServeTarget[] = []
    const builds: string[] = []
    const resolverFor = (target: ELinuxServeTarget) =>
      createDevServeResolver({
        repo: async () => '/repo',
        probe: async () => sourceWith(''),
        build: async ({ outfile, target: requested }) => {
          targets.push(requested)
          builds.push(outfile)
          await writeFile(outfile, `serve for ${requested}`)
        },
        target,
        cacheRoot: () => root,
        now: () => 0,
        keep: 3,
      })

    const arm64 = await resolverFor(ELinuxServeTarget.Arm64)({})
    const x64 = await resolverFor(ELinuxServeTarget.X64)({})

    expect(targets).toEqual([ELinuxServeTarget.Arm64, ELinuxServeTarget.X64])
    expect(builds.map((outfile) => outfile.split('/').pop())).toEqual([
      'atlas-serve-linux-arm64',
      'atlas-serve-linux-x64',
    ])
    expect(arm64.path).toBe(join(root, keyOf('', ELinuxServeTarget.Arm64), 'atlas-serve-linux-arm64'))
    expect(x64.path).toBe(join(root, keyOf('', ELinuxServeTarget.X64), 'atlas-serve-linux-x64'))
    expect(keyOf('', ELinuxServeTarget.Arm64)).not.toBe(keyOf('', ELinuxServeTarget.X64))
    expect(arm64.version).not.toBe(x64.version)
  })
})

describe('devServeBinaryNameOf', () => {
  it('names the binary after the linux target', () => {
    expect(devServeBinaryNameOf(ELinuxServeTarget.X64)).toBe('atlas-serve-linux-x64')
    expect(devServeBinaryNameOf(ELinuxServeTarget.Arm64)).toBe('atlas-serve-linux-arm64')
  })
})

describe('devServeBuildArgvOf', () => {
  it('passes the target and outfile to the serve build script', () => {
    const argv = devServeBuildArgvOf({ target: ELinuxServeTarget.Arm64, outfile: '/stage/out' })

    expect(argv.slice(1)).toEqual(['scripts/build-serve.ts', '--target', 'bun-linux-arm64', '--outfile', '/stage/out'])
  })
})

describe('devServeResolverFor targets', () => {
  it('gives x64 and arm64 distinct shared resolvers for the same build, each held once', () => {
    const build = { kind: EBuildKind.Dev, repo: '/repo', stamp: 's' } as const
    const x64 = devServeResolverFor(build, { target: ELinuxServeTarget.X64 })
    const arm64 = devServeResolverFor(build, { target: ELinuxServeTarget.Arm64 })

    expect(arm64).toBeDefined()
    expect(arm64).not.toBe(x64)
    expect(devServeResolverFor(build, { target: ELinuxServeTarget.Arm64 })).toBe(arm64)
    expect(devServeResolverFor(build)).toBe(x64)
  })

  describe('on an arm64 host', () => {
    const realArch = Object.getOwnPropertyDescriptor(process, 'arch')

    afterEach(() => {
      if (realArch !== undefined) Object.defineProperty(process, 'arch', realArch)
    })

    it('keeps the Vercel dev serve on linux-x64 even on an arm64 host', () => {
      Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true })
      const builds = [
        { kind: EBuildKind.Dev, repo: '/repo', stamp: 's' } as const,
        { kind: EBuildKind.Source } as const,
      ]

      for (const build of builds) {
        const asLiveCloudCallsIt = devServeResolverFor(build)

        expect(process.arch).toBe('arm64')
        expect(asLiveCloudCallsIt).toBeDefined()
        expect(asLiveCloudCallsIt).toBe(devServeResolverFor(build, { target: ELinuxServeTarget.X64 }))
        expect(asLiveCloudCallsIt).not.toBe(devServeResolverFor(build, { target: ELinuxServeTarget.Arm64 }))
      }
    })
  })
})
