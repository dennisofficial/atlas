import type { INestApplication } from '@nestjs/common'
import { routePathOf, routePrefixOf, sourcePathOf } from '@dltech/atlas-artifacts'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import {
  artifactBuildStatusOutputSchema,
  artifactGetOutputSchema,
  artifactListOutputSchema,
  artifactRouteSchema,
  artifactSourceExportOutputSchema,
} from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { ARTIFACT_BUILD_STALE_MS, STALE_BUILD_FAILURE } from './artifact-library.service'
import { dataOf, trpcQuery } from '../session-trpc-test-app'
import { FakeArtifactBlobStore } from './artifact-blob-store.fakes'
import {
  FakeArtifactSandbox,
  builtFiles,
  finishedCommand,
  sandboxResult,
} from './artifact-sandbox.fakes'
import {
  ARTIFACT_DOMAIN,
  buildArtifactsApp,
  FakeArtifactJobDispatcher,
  OWNER,
  SOURCE_BODIES,
  publishArtifact,
  runDispatchedBuilds,
  withSubdomain,
} from './artifacts.router.fixture'

const BUILD_SPEC = {
  build: { install: 'bun install', cmd: 'bun run build', outDir: 'dist' },
}

describe('ArtifactsRouter library', () => {
  useTestDatabase()
  let app: INestApplication
  const blobs = new FakeArtifactBlobStore()
  const sandbox = new FakeArtifactSandbox()
  const jobs = new FakeArtifactJobDispatcher()

  const get = (token: string, subdomain: string) =>
    trpcQuery({ app, path: 'artifacts.get', token, input: { subdomain } })
  const list = (token: string) => trpcQuery({ app, path: 'artifacts.list', token })
  const sourceExport = (token: string, subdomain: string) =>
    trpcQuery({ app, path: 'artifacts.sourceExport', token, input: { subdomain } })
  const buildStatus = (token: string, subdomain: string, version: number) =>
    trpcQuery({ app, path: 'artifacts.buildStatus', token, input: { subdomain, version } })
  const publish = (
    args: {
      input?: unknown
      buildSpec?: unknown
      bodies?: Record<string, string>
      drain?: boolean
    } = {},
  ) => publishArtifact({ app, blobs, sandbox, jobs, ...args })

  beforeEach(async () => {
    await seedSessionUsers()
    blobs.reset()
    sandbox.reset()
    jobs.reset()
    app = await buildArtifactsApp({ blobs, jobs })
  })

  afterEach(() => app.close())

  it('projects the stored build log and duration of the last build', async () => {
    sandbox.scripted(
      sandboxResult({
        install: finishedCommand({ stdout: 'installed' }),
        outDir: builtFiles([{ path: 'index.html', body: '<h1>built</h1>' }]),
      }),
    )
    const published = await publish({ buildSpec: BUILD_SPEC })

    const detail = artifactGetOutputSchema.parse(
      dataOf((await get(OWNER, published.subdomain)).body),
    )

    expect(detail.build.log).toContain('installed')
    expect(detail.build.durationMs).toBeGreaterThanOrEqual(0)
    expect(detail.build.failure).toBeNull()
    const route = routePrefixOf({ id: published.subdomain })
    expect([...blobs.stored.keys()].filter((key) => key.startsWith(route)).sort()).toEqual([
      `${route}v1/index.html`,
    ])
    expect(
      artifactRouteSchema.parse(blobs.bodyOf(routePathOf({ id: published.subdomain }))),
    ).toMatchObject({
      version: 1,
    })
  })

  describe('artifacts.list and artifacts.get', () => {
    it('lists published artifacts with their live URL, status and update time', async () => {
      const published = await publish()

      const [summary] = artifactListOutputSchema.parse(dataOf((await list(OWNER)).body)).artifacts

      expect(summary).toMatchObject({
        subdomain: published.subdomain,
        name: 'demo',
        url: `https://${published.subdomain}.${ARTIFACT_DOMAIN}`,
        status: 'ready',
      })
      expect(Date.parse(summary?.updatedAt ?? '')).toBeGreaterThan(0)
      const empty = artifactListOutputSchema.parse(dataOf((await list('session-b')).body))
      expect(empty.artifacts).toEqual([])
    })

    it('returns the artifact and its last build for a sandbox', async () => {
      const published = await publish()

      const detail = artifactGetOutputSchema.parse(
        dataOf((await get('sandbox-token-a', published.subdomain)).body),
      )

      expect(detail.artifact.status).toBe('ready')
      expect(detail.build).toMatchObject({ failure: null, log: null, durationMs: null })
    })

    it('answers 404 for an unknown subdomain and for another user', async () => {
      const published = await publish()

      expect((await get(OWNER, 'missing')).status).toBe(404)
      expect((await get('session-b', published.subdomain)).status).toBe(404)
    })
  })

  describe('artifacts.buildStatus', () => {
    it('reports a ready version with its url', async () => {
      const published = await publish()

      const status = artifactBuildStatusOutputSchema.parse(
        dataOf((await buildStatus(OWNER, published.subdomain, published.version)).body),
      )

      expect(status).toMatchObject({
        subdomain: published.subdomain,
        version: published.version,
        url: `https://${published.subdomain}.${ARTIFACT_DOMAIN}`,
        outcome: 'ready',
        failure: null,
        supersededBy: null,
      })
    })

    it('reports building until the task records an outcome', async () => {
      const published = await publish({ buildSpec: BUILD_SPEC, drain: false })
      const status = artifactBuildStatusOutputSchema.parse(
        dataOf((await buildStatus(OWNER, published.subdomain, published.version)).body),
      )

      expect(status.outcome).toBe('building')
    })

    it('reports a build that never reported back as failed once it is stale', async () => {
      const published = await publish({ buildSpec: BUILD_SPEC, drain: false })
      await db.orm.public.ArtifactVersion.where({ version: published.version }).update({
        createdAt: new Date(Date.now() - ARTIFACT_BUILD_STALE_MS - 1000),
      })

      const status = artifactBuildStatusOutputSchema.parse(
        dataOf((await buildStatus(OWNER, published.subdomain, published.version)).body),
      )

      expect(status).toMatchObject({ outcome: 'failed', failure: STALE_BUILD_FAILURE })
    })

    it('reports a failed build with its reason', async () => {
      const published = await publish({ buildSpec: BUILD_SPEC, drain: false })
      sandbox.scripted(sandboxResult({ build: finishedCommand({ exitCode: 1, stderr: 'boom' }) }))
      await runDispatchedBuilds({ jobs, blobs, sandbox })

      const status = artifactBuildStatusOutputSchema.parse(
        dataOf((await buildStatus(OWNER, published.subdomain, published.version)).body),
      )

      expect(status).toMatchObject({
        outcome: 'failed',
        failure: 'build failed with exit code 1: boom',
      })
    })

    it('reports a newer version superseding this one, even after the row is gone', async () => {
      const first = await publish()
      const second = await publish({ input: withSubdomain(first.subdomain) })

      const kept = artifactBuildStatusOutputSchema.parse(
        dataOf((await buildStatus(OWNER, first.subdomain, second.version)).body),
      )
      const pruned = artifactBuildStatusOutputSchema.parse(
        dataOf((await buildStatus(OWNER, first.subdomain, first.version)).body),
      )

      expect(kept).toMatchObject({ outcome: 'ready', supersededBy: null })
      expect(pruned).toMatchObject({ outcome: 'superseded', supersededBy: second.version })
    })

    it("refuses another user's artifact and an unknown version", async () => {
      const published = await publish()

      expect((await buildStatus('session-b', published.subdomain, published.version)).status).toBe(
        404,
      )
      expect((await buildStatus(OWNER, published.subdomain, 99)).status).toBe(404)
    })
  })

  describe('artifacts.sourceExport', () => {
    it('signs a readable GET for every source file the artifact holds', async () => {
      const published = await publish()

      const exported = artifactSourceExportOutputSchema.parse(
        dataOf((await sourceExport(OWNER, published.subdomain)).body),
      )

      expect(exported.entries.map((entry) => entry.path)).toEqual(['app.css', 'index.html'])
      expect(exported.entries[1]?.url).toBe(
        `https://blob.test/get/${sourcePathOf({ id: published.subdomain, path: 'index.html' })}?ttl=3600000`,
      )
      const body = await blobs.read({
        pathname: sourcePathOf({ id: published.subdomain, path: 'index.html' }),
      })
      expect(body?.toString()).toBe(SOURCE_BODIES['index.html'] as string)
    })

    it("refuses another user's artifact", async () => {
      const published = await publish()

      expect((await sourceExport('session-b', published.subdomain)).status).toBe(404)
    })
  })
})
