import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { lockedRuntimePackages } from '../build-runtime-packages'

const entry = ({
  id,
  dependencies,
}: {
  id: string
  dependencies?: Record<string, string>
}): unknown[] => [id, '', dependencies ? { dependencies } : {}, `sha512-${id}`]

const lockText = `{
  "lockfileVersion": 3,
  "configVersion": 1,
  "workspaces": { "": { "name": "fixture" }, },
  "packages": ${JSON.stringify({
    express: entry({
      id: 'express@5.3.0',
      dependencies: { router: '^2.2.0', debug: '^4.4.0', qs: '^6.16.0' },
    }),
    router: entry({
      id: 'router@2.2.0',
      dependencies: { debug: '^4.4.0', 'is-promise': '^4.0.0' },
    }),
    'router/debug': entry({ id: 'debug@4.1.0', dependencies: { ms: '^2.1.1' } }),
    debug: entry({ id: 'debug@4.4.3', dependencies: { ms: '^2.1.3' } }),
    ms: entry({ id: 'ms@2.1.3' }),
    'router/ms': entry({ id: 'ms@2.1.2' }),
    'is-promise': entry({ id: 'is-promise@4.0.0' }),
    qs: entry({ id: 'qs@6.16.0' }),
    unrelated: entry({ id: 'unrelated@1.0.0' }),
  })},
}`

describe('lockedRuntimePackages', () => {
  let dir: string
  let lockPath: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'locked-runtime-packages-'))
    lockPath = join(dir, 'bun.lock')
    writeFileSync(lockPath, lockText)
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('pins the root and its transitive dependencies, and nothing else', async () => {
    const { dependencies, lock } = await lockedRuntimePackages({ lockPath, roots: ['express'] })

    expect(dependencies).toEqual({ express: '5.3.0' })
    expect(Object.keys(lock.packages).sort()).toEqual([
      'debug',
      'express',
      'is-promise',
      'ms',
      'qs',
      'router',
      'router/debug',
      'router/ms',
    ])
    expect(lock.workspaces).toEqual({ '': { dependencies: { express: '5.3.0' } } })
    expect(lock).toMatchObject({ lockfileVersion: 3, configVersion: 1 })
  })

  it('resolves a dependency to the nested parent/child key before the hoisted one', async () => {
    const { lock } = await lockedRuntimePackages({ lockPath, roots: ['router'] })

    expect(lock.packages['router/debug']).toEqual(
      entry({ id: 'debug@4.1.0', dependencies: { ms: '^2.1.1' } }),
    )
    expect(lock.packages['router/ms']).toBeDefined()
    expect(lock.packages.debug).toBeUndefined()
    expect(lock.packages.ms).toBeUndefined()
  })

  it('fails naming the package when a root is missing from the lock', async () => {
    await expect(lockedRuntimePackages({ lockPath, roots: ['not-installed'] })).rejects.toThrow(
      /"not-installed" is missing/,
    )
  })

  it('fails when a transitive dependency is missing from the lock', async () => {
    const brokenPath = join(dir, 'broken.lock')
    writeFileSync(brokenPath, lockText.replace(/"qs":\[[^\]]*\],?/, ''))

    await expect(
      lockedRuntimePackages({ lockPath: brokenPath, roots: ['express'] }),
    ).rejects.toThrow(/"qs" is missing/)
  })
})
