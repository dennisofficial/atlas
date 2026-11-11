import type { INestApplication } from '@nestjs/common'
import { sourcePathOf } from '@dltech/atlas-artifacts'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import {
  artifactBeginPublishOutputSchema,
  artifactGetOutputSchema,
  artifactListOutputSchema,
  artifactSourceExportOutputSchema,
} from '@dltech/atlas-wire'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { dataOf, trpcMutation, trpcQuery } from '../session-trpc-test-app'
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
  OWNER,
  SOURCE_BODIES,
  publishArtifact,
  seedSources,
  withSlug,
} from './artifacts.router.fixture'

describe('ArtifactsRouter library', () => {
  useTestDatabase()
  let app: INestApplication
  const blobs = new FakeArtifactBlobStore()
  const sandbox = new FakeArtifactSandbox()

  const get = (token: string, slug: string) =>
    trpcQuery({ app, path: 'artifacts.get', token, input: { slug } })
  const list = (token: string) => trpcQuery({ app, path: 'artifacts.list', token })
  const sourceExport = (token: string, slug: string) =>
    trpcQuery({ app, path: 'artifacts.sourceExport', token, input: { slug } })
  const publish = () => publishArtifact({ app, blobs })

  beforeEach(async () => {
    await seedSessionUsers()
    blobs.reset()
    sandbox.reset()
    app = await buildArtifactsApp({ blobs, sandbox })
  })

  afterEach(() => app.close())

  it('projects the stored build log and duration of the last build', async () => {
    await publish()
    const granted = artifactBeginPublishOutputSchema.parse(
      dataOf(
        (
          await trpcMutation({
            app,
            path: 'artifacts.beginPublish',
            token: 'sandbox-token-a',
            input: withSlug('demo'),
          }).expect(200)
        ).body,
      ),
    )
    await seedSources({
      blobs,
      artifactId: granted.artifactId,
      paths: granted.uploads.map((upload) => upload.path),
    })
    sandbox.scripted(
      sandboxResult({
        install: finishedCommand({ stdout: 'installed' }),
        outDir: builtFiles([{ path: 'index.html', body: '<h1>built</h1>' }]),
      }),
    )
    await trpcMutation({
      app,
      path: 'artifacts.commitPublish',
      token: 'sandbox-token-a',
      input: {
        artifactId: granted.artifactId,
        version: granted.version,
        spec: { build: { install: 'bun install', cmd: 'bun run build', outDir: 'dist' } },
      },
    }).expect(200)

    const detail = artifactGetOutputSchema.parse(dataOf((await get(OWNER, 'demo')).body))

    expect(detail.build.log).toContain('installed')
    expect(detail.build.durationMs).toBeGreaterThanOrEqual(0)
    expect(detail.build.failure).toBeNull()
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
      await publish()

      const detail = artifactGetOutputSchema.parse(
        dataOf((await get('sandbox-token-a', 'demo')).body),
      )

      expect(detail.artifact.status).toBe('ready')
      expect(detail.build).toMatchObject({ failure: null, log: null, durationMs: null })
    })

    it('answers 404 for an unknown slug and for another user', async () => {
      await publish()

      expect((await get(OWNER, 'missing')).status).toBe(404)
      expect((await get('session-b', 'demo')).status).toBe(404)
    })
  })

  describe('artifacts.sourceExport', () => {
    it('signs a readable GET for every source file the artifact holds', async () => {
      const published = await publish()

      const exported = artifactSourceExportOutputSchema.parse(
        dataOf((await sourceExport(OWNER, 'demo')).body),
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
      await publish()

      expect((await sourceExport('session-b', 'demo')).status).toBe(404)
    })
  })
})
