import {
  routePathOf,
  routePrefixOf,
  routeVersionPrefixOf,
  sourcePathOf,
} from '@dltech/atlas-artifacts'
import { db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { EArtifactBuildOutcome, type ArtifactBuildPayload } from './artifact-build.contract'
import { failArtifactBuild, runArtifactBuild } from './artifact-build-run'
import { FakeArtifactBlobStore } from './artifact-blob-store.fakes'
import { ArtifactLifecycleService } from './artifact-lifecycle.service'
import { FakeArtifactSandbox, builtFiles, sandboxResult } from './artifact-sandbox.fakes'
import {
  USER_ID,
  depsOf,
  gateOf,
  keysUnder,
  routeOf,
  rowOf,
  seedRouteObject,
  seedVersion,
} from './artifact-build.fixture'

const BUILDER = { build: { cmd: 'bun run build', outDir: 'dist' } }

describe('artifact-build interleavings', () => {
  useTestDatabase()
  const blobs = new FakeArtifactBlobStore()
  const sandbox = new FakeArtifactSandbox()
  const deps = () => depsOf({ blobs, sandbox })

  const built = () => sandboxResult({ outDir: builtFiles([{ path: 'index.html', body: 'built' }]) })

  beforeEach(async () => {
    await seedUser({ db, id: USER_ID })
    blobs.reset()
    sandbox.reset()
  })

  it('keeps v2 live when the older build finishes after v2 switched', async () => {
    const older = await seedVersion({
      blobs,
      subdomain: 'race-a',
      version: 1,
      currentVersion: 1,
      builder: BUILDER,
    })
    sandbox.scripted(built(), built())
    const gate = gateOf()
    let runs = 0
    sandbox.beforeRun(async () => {
      runs += 1
      if (runs === 1) await gate.hold()
    })

    const slow = runArtifactBuild({ payload: older.payload, deps: deps() })
    await gate.reached
    const newer = await seedVersion({
      blobs,
      subdomain: 'race-a',
      version: 2,
      currentVersion: 2,
      builder: BUILDER,
    })
    const fast = await runArtifactBuild({ payload: newer.payload, deps: deps() })
    gate.open()
    const late = await slow

    expect(fast.outcome).toBe(EArtifactBuildOutcome.Ready)
    expect(late.outcome).toBe(EArtifactBuildOutcome.Superseded)
    expect(routeOf({ blobs, subdomain: 'race-a' }).version).toBe(2)
    expect(
      keysUnder({ blobs, prefix: routeVersionPrefixOf({ id: 'race-a', version: 2 }) }),
    ).toEqual([`${routeVersionPrefixOf({ id: 'race-a', version: 2 })}index.html`])
    expect(
      keysUnder({ blobs, prefix: routeVersionPrefixOf({ id: 'race-a', version: 1 }) }),
    ).toEqual([])
    expect(await rowOf({ artifactId: older.artifactId, version: 1 })).toBeNull()
  })

  it('leaves a newer version folder alone when an older build reaches the switch mid-write', async () => {
    const older = await seedVersion({ blobs, subdomain: 'race-b', version: 1, currentVersion: 1 })
    const newer = await seedVersion({ blobs, subdomain: 'race-b', version: 2, currentVersion: 2 })
    const newerPrefix = routeVersionPrefixOf({ id: 'race-b', version: 2 })
    const gate = gateOf()
    blobs.beforePut(async ({ pathname }) => {
      if (pathname === `${newerPrefix}index.html`) await gate.hold()
    })

    const midWrite = runArtifactBuild({ payload: newer.payload, deps: deps() })
    await gate.reached
    const late = await runArtifactBuild({ payload: older.payload, deps: deps() })

    expect(late.outcome).toBe(EArtifactBuildOutcome.Superseded)
    expect(blobs.stored.has(`${newerPrefix}index.html`)).toBe(false)
    gate.open()
    const switched = await midWrite

    expect(switched.outcome).toBe(EArtifactBuildOutcome.Ready)
    expect(routeOf({ blobs, subdomain: 'race-b' }).version).toBe(2)
    expect(keysUnder({ blobs, prefix: newerPrefix })).toHaveLength(2)
  })

  it('prunes the older folders and legacy keys, never a newer in-flight folder', async () => {
    const seeded = await seedVersion({ blobs, subdomain: 'race-c', version: 3, currentVersion: 3 })
    const root = routePrefixOf({ id: 'race-c' })
    for (const key of ['v1/index.html', 'v2/index.html', 'legacy.html', 'v4/index.html']) {
      blobs.seed({ pathname: `${root}${key}`, body: 'stale' })
    }

    const result = await runArtifactBuild({ payload: seeded.payload, deps: deps() })

    expect(result.outcome).toBe(EArtifactBuildOutcome.Ready)
    expect(keysUnder({ blobs, prefix: root })).toEqual([
      `${root}v3/app.css`,
      `${root}v3/index.html`,
      `${root}v4/index.html`,
    ])
  })

  it('never resurrects the route object when the artifact is unpublished mid-build', async () => {
    const seeded = await seedVersion({
      blobs,
      subdomain: 'race-d',
      version: 1,
      currentVersion: 1,
      builder: BUILDER,
    })
    sandbox.scripted(built())
    sandbox.beforeRun(async () => {
      await new ArtifactLifecycleService(blobs).unpublish({
        userId: USER_ID,
        subdomain: 'race-d',
      })
    })

    const result = await runArtifactBuild({ payload: seeded.payload, deps: deps() })

    expect(result.outcome).toBe(EArtifactBuildOutcome.Failed)
    expect(blobs.stored.has(routePathOf({ id: 'race-d' }))).toBe(false)
    expect(
      keysUnder({ blobs, prefix: routeVersionPrefixOf({ id: 'race-d', version: 1 }) }),
    ).toEqual([])
    expect(await rowOf({ artifactId: seeded.artifactId, version: 1 })).toBeNull()
  })

  it('builds with the verified spec when the source changes after verification', async () => {
    const seeded = await seedVersion({
      blobs,
      subdomain: 'race-e',
      version: 1,
      currentVersion: 1,
      builder: { build: { cmd: 'bun run original', outDir: 'dist' } },
    })
    sandbox.scripted(built())
    sandbox.beforeRun(async () => {
      blobs.seed({
        pathname: sourcePathOf({ id: 'race-e', path: 'artifact.json' }),
        body: JSON.stringify({ build: { cmd: 'bun run swapped', outDir: 'dist' } }),
      })
    })

    const result = await runArtifactBuild({ payload: seeded.payload, deps: deps() })

    expect(result.outcome).toBe(EArtifactBuildOutcome.Ready)
    expect(sandbox.lastRequest.cmd).toBe('bun run original')
  })

  it('stays ready when the prune throws after the switch', async () => {
    const seeded = await seedVersion({ blobs, subdomain: 'race-f', version: 1, currentVersion: 1 })
    const root = routePrefixOf({ id: 'race-f' })
    const list = blobs.list.bind(blobs)
    blobs.list = async (args) => {
      if (args.prefix === root) throw new Error('the bucket is unavailable')
      return list(args)
    }

    try {
      const result = await runArtifactBuild({ payload: seeded.payload, deps: deps() })

      expect(result.outcome).toBe(EArtifactBuildOutcome.Ready)
      expect(await rowOf({ artifactId: seeded.artifactId, version: 1 })).toMatchObject({
        status: 'ready',
      })
      expect(routeOf({ blobs, subdomain: 'race-f' }).version).toBe(1)
    } finally {
      blobs.list = list
    }
  })

  it('rolls the switch back when the route put throws', async () => {
    await seedVersion({
      blobs,
      subdomain: 'race-g',
      version: 1,
      currentVersion: 1,
      status: 'ready',
    })
    seedRouteObject({ blobs, subdomain: 'race-g', version: 1 })
    const seeded = await seedVersion({ blobs, subdomain: 'race-g', version: 2, currentVersion: 2 })
    blobs.beforePut(async ({ pathname }) => {
      if (pathname === routePathOf({ id: 'race-g' })) throw new Error('the route store is down')
    })

    await expect(runArtifactBuild({ payload: seeded.payload, deps: deps() })).rejects.toThrow(
      'the route store is down',
    )

    expect(await rowOf({ artifactId: seeded.artifactId, version: 2 })).toMatchObject({
      status: 'building',
    })
    expect(routeOf({ blobs, subdomain: 'race-g' }).version).toBe(1)

    await failArtifactBuild({
      payload: seeded.payload,
      deps: deps(),
      error: new Error('the route store is down'),
    })

    expect(await rowOf({ artifactId: seeded.artifactId, version: 2 })).toMatchObject({
      status: 'failed',
      failure: 'the build job stopped before finishing: the route store is down',
    })
  })

  it('records a version ready when the route object already names it', async () => {
    const seeded: { payload: ArtifactBuildPayload } = await seedVersion({
      blobs,
      subdomain: 'race-h',
      version: 1,
      currentVersion: 1,
    })
    seedRouteObject({ blobs, subdomain: 'race-h', version: 1 })

    await failArtifactBuild({ payload: seeded.payload, deps: deps(), error: new Error('late') })

    expect(await rowOf({ artifactId: seeded.payload.artifactId, version: 1 })).toMatchObject({
      status: 'ready',
      failure: null,
    })
  })
})
