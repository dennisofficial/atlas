import type { INestApplication } from '@nestjs/common'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { artifactBeginPublishOutputSchema, artifactGetOutputSchema } from '@dltech/atlas-wire'
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
import { ArtifactRetention } from './artifact-retention'
import {
  buildArtifactsApp,
  OWNER,
  publishArtifact,
  seedUploads,
  withSlug,
} from './artifacts.router.fixture'

describe('ArtifactsRouter stored build data', () => {
  useTestDatabase()
  let app: INestApplication
  const blobs = new FakeArtifactBlobStore()
  const retention = new ArtifactRetention(blobs)
  const sandbox = new FakeArtifactSandbox()

  const get = (token: string, slug: string) =>
    trpcQuery({ app, path: 'artifacts.get', token, input: { slug } })

  beforeEach(async () => {
    await seedSessionUsers()
    blobs.reset()
    sandbox.reset()
    app = await buildArtifactsApp({ blobs, retention, sandbox })
  })

  afterEach(() => app.close())

  it('projects the source and spec hashes a version was published with', async () => {
    await publishArtifact({ app, blobs })

    const detail = artifactGetOutputSchema.parse(dataOf((await get(OWNER, 'demo')).body))

    expect(detail.artifact.sourceHash).toMatch(/^[0-9a-f]{64}$/)
    expect(detail.artifact.specHash).toMatch(/^[0-9a-f]{64}$/)
    expect(Date.parse(detail.artifact.createdAt)).toBeGreaterThan(0)
  })

  it('projects the stored build log and duration, and null for a version with neither', async () => {
    await publishArtifact({ app, blobs })
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
    seedUploads({ blobs, shas: granted.uploads.map((upload) => upload.sha256) })
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
    const built = detail.versions.find((version) => version.version === 2)
    const first = detail.versions.find((version) => version.version === 1)

    expect(built?.log).toContain('installed')
    expect(built?.durationMs).toBeGreaterThanOrEqual(0)
    expect(first?.log).toBeNull()
    expect(first?.durationMs).toBeNull()
  })
})
