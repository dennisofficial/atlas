import { routePathOf, routeVersionPrefixOf, sourcePathOf } from '@dltech/atlas-artifacts'
import { db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { EArtifactBuildOutcome } from '../../api/cloud/artifacts/artifact-build.contract'
import { failArtifactBuild, runArtifactBuild } from '../../api/cloud/artifacts/artifact-build-run'
import { FakeArtifactBlobStore } from '../../api/cloud/artifacts/artifact-blob-store.fakes'
import {
  FakeArtifactSandbox,
  builtFiles,
  finishedCommand,
  sandboxResult,
} from '../../api/cloud/artifacts/artifact-sandbox.fakes'
import { USER_ID, depsOf, keysUnder, routeOf, rowOf, seedVersion } from './artifact-build.fixture'

describe('artifact-build task', () => {
  useTestDatabase()
  const blobs = new FakeArtifactBlobStore()
  const sandbox = new FakeArtifactSandbox()
  const deps = () => depsOf({ blobs, sandbox })
  const keys = (prefix: string) => keysUnder({ blobs, prefix })

  beforeEach(async () => {
    await seedUser({ db, id: USER_ID })
    blobs.reset()
    sandbox.reset()
  })

  it('writes the pushed source into its version folder and switches the route', async () => {
    const seeded = await seedVersion({
      blobs,
      subdomain: 'demo-a',
      version: 1,
      currentVersion: 1,
    })

    const result = await runArtifactBuild({ payload: seeded.payload, deps: deps() })

    expect(result.outcome).toBe(EArtifactBuildOutcome.Ready)
    const prefix = routeVersionPrefixOf({ id: 'demo-a', version: 1 })
    expect(keys(prefix)).toEqual([`${prefix}app.css`, `${prefix}index.html`])
    expect(routeOf({ blobs, subdomain: 'demo-a' })).toMatchObject({
      version: 1,
      subdomain: 'demo-a',
    })
    expect(await rowOf({ artifactId: seeded.artifactId, version: seeded.version })).toMatchObject({
      status: 'ready',
      failure: null,
    })
  })

  it('moves the live version and drops the older folders after a successful build', async () => {
    const first = await seedVersion({
      blobs,
      subdomain: 'demo-b',
      version: 1,
      currentVersion: 1,
    })
    await runArtifactBuild({ payload: first.payload, deps: deps() })
    const second = await seedVersion({
      blobs,
      subdomain: 'demo-b',
      version: 2,
      currentVersion: 2,
    })

    const result = await runArtifactBuild({ payload: second.payload, deps: deps() })

    expect(result.outcome).toBe(EArtifactBuildOutcome.Ready)
    expect(keys(routeVersionPrefixOf({ id: 'demo-b', version: 1 }))).toEqual([])
    expect(keys(routeVersionPrefixOf({ id: 'demo-b', version: 2 }))).toHaveLength(2)
    expect(routeOf({ blobs, subdomain: 'demo-b' }).version).toBe(2)
    expect(await rowOf({ ...first, version: 1 })).toBeNull()
  })

  it('keeps the live version and the route object when the build fails', async () => {
    const first = await seedVersion({
      blobs,
      subdomain: 'demo-c',
      version: 1,
      currentVersion: 1,
    })
    await runArtifactBuild({ payload: first.payload, deps: deps() })
    const routeBefore = blobs.stored.get(routePathOf({ id: 'demo-c' }))?.body
    const second = await seedVersion({
      blobs,
      subdomain: 'demo-c',
      version: 2,
      currentVersion: 2,
      builder: { build: { cmd: 'bun run build', outDir: 'dist' } },
    })
    sandbox.scripted(
      sandboxResult({
        build: finishedCommand({ exitCode: 1, stderr: 'TS2304: cannot find name' }),
      }),
    )

    const result = await runArtifactBuild({ payload: second.payload, deps: deps() })

    expect(result.outcome).toBe(EArtifactBuildOutcome.Failed)
    expect(keys(routeVersionPrefixOf({ id: 'demo-c', version: 2 }))).toEqual([])
    expect(keys(routeVersionPrefixOf({ id: 'demo-c', version: 1 }))).toHaveLength(2)
    expect(blobs.stored.get(routePathOf({ id: 'demo-c' }))?.body).toBe(routeBefore)
    expect(routeOf({ blobs, subdomain: 'demo-c' }).version).toBe(1)
    expect(await rowOf({ artifactId: second.artifactId, version: second.version })).toMatchObject({
      status: 'failed',
      failure: 'build failed with exit code 1: TS2304: cannot find name',
    })
  })

  it('records the built output and its log, not the pushed source', async () => {
    const seeded = await seedVersion({
      blobs,
      subdomain: 'demo-d',
      version: 1,
      currentVersion: 1,
      builder: { build: { install: 'bun install', cmd: 'bun run build', outDir: 'dist' } },
    })
    sandbox.scripted(
      sandboxResult({
        install: finishedCommand({ stdout: 'installed' }),
        outDir: builtFiles([{ path: 'index.html', body: '<h1>built</h1>' }]),
      }),
    )

    const result = await runArtifactBuild({ payload: seeded.payload, deps: deps() })

    expect(result.outcome).toBe(EArtifactBuildOutcome.Ready)
    expect(sandbox.lastRequest.owner).toEqual({ userId: USER_ID })
    expect(sandbox.lastRequest.timeoutMs).toBe(300_000)
    const prefix = routeVersionPrefixOf({ id: 'demo-d', version: 1 })
    expect((await blobs.read({ pathname: `${prefix}index.html` }))?.toString()).toBe(
      '<h1>built</h1>',
    )
    const row = await rowOf({ artifactId: seeded.artifactId, version: seeded.version })
    expect(row).toMatchObject({ status: 'ready', fileCount: 1 })
    expect(row?.log).toContain('installed')
  })

  it('supersedes a version a newer push already replaced', async () => {
    const seeded = await seedVersion({
      blobs,
      subdomain: 'demo-e',
      version: 1,
      currentVersion: 2,
    })

    const result = await runArtifactBuild({ payload: seeded.payload, deps: deps() })

    expect(result.outcome).toBe(EArtifactBuildOutcome.Superseded)
    expect(keys(routeVersionPrefixOf({ id: 'demo-e', version: 1 }))).toEqual([])
    expect(await rowOf({ artifactId: seeded.artifactId, version: seeded.version })).toMatchObject({
      status: 'superseded',
    })
  })

  it('supersedes a version a newer push replaced while it was building', async () => {
    const seeded = await seedVersion({
      blobs,
      subdomain: 'demo-f',
      version: 1,
      currentVersion: 1,
      builder: { build: { cmd: 'bun run build', outDir: 'dist' } },
    })
    sandbox.scripted(sandboxResult({ outDir: builtFiles([{ path: 'index.html', body: 'built' }]) }))
    sandbox.beforeRun(async () => {
      await db.orm.public.Artifact.where({ id: seeded.artifactId }).update({ currentVersion: 2 })
    })

    const result = await runArtifactBuild({ payload: seeded.payload, deps: deps() })

    expect(result.outcome).toBe(EArtifactBuildOutcome.Superseded)
    expect(keys(routeVersionPrefixOf({ id: 'demo-f', version: 1 }))).toEqual([])
    expect(blobs.stored.has(routePathOf({ id: 'demo-f' }))).toBe(false)
    expect(await rowOf({ artifactId: seeded.artifactId, version: seeded.version })).toMatchObject({
      status: 'superseded',
    })
  })

  it('fails when the pushed source no longer matches its hash', async () => {
    const seeded = await seedVersion({
      blobs,
      subdomain: 'demo-g',
      version: 1,
      currentVersion: 1,
    })
    blobs.seed({ pathname: sourcePathOf({ id: 'demo-g', path: 'index.html' }), body: 'swapped' })

    const result = await runArtifactBuild({ payload: seeded.payload, deps: deps() })

    expect(result.outcome).toBe(EArtifactBuildOutcome.Failed)
    expect(await rowOf({ artifactId: seeded.artifactId, version: seeded.version })).toMatchObject({
      status: 'failed',
      failure: 'the pushed source changed before the build read it',
    })
    expect(blobs.stored.has(routePathOf({ id: 'demo-g' }))).toBe(false)
  })

  it('never deletes a newer version row when an older one finishes', async () => {
    const older = await seedVersion({
      blobs,
      subdomain: 'demo-h',
      version: 1,
      currentVersion: 1,
    })
    const newer = await seedVersion({
      blobs,
      subdomain: 'demo-h',
      version: 2,
      currentVersion: 2,
      status: 'ready',
    })

    await runArtifactBuild({ payload: older.payload, deps: deps() })

    expect(await rowOf({ artifactId: newer.artifactId, version: 2 })).toMatchObject({
      status: 'ready',
    })
    expect(await rowOf({ artifactId: older.artifactId, version: 1 })).toMatchObject({
      status: 'superseded',
    })
  })

  it('marks a version still building as failed when the job stops', async () => {
    const seeded = await seedVersion({
      blobs,
      subdomain: 'demo-i',
      version: 1,
      currentVersion: 1,
    })

    await failArtifactBuild({
      payload: seeded.payload,
      deps: deps(),
      error: new Error('sandbox exploded'),
    })

    expect(await rowOf({ artifactId: seeded.artifactId, version: seeded.version })).toMatchObject({
      status: 'failed',
      failure: 'the build job stopped before finishing: sandbox exploded',
    })
  })

  it('leaves a finished version alone when the job stops late', async () => {
    const seeded = await seedVersion({
      blobs,
      subdomain: 'demo-j',
      version: 1,
      currentVersion: 1,
      status: 'ready',
    })

    await failArtifactBuild({ payload: seeded.payload, deps: deps(), error: new Error('late') })

    expect(await rowOf({ artifactId: seeded.artifactId, version: seeded.version })).toMatchObject({
      status: 'ready',
      failure: null,
    })
  })
})
