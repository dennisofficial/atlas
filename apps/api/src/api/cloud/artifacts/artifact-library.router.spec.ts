import type { INestApplication } from '@nestjs/common'
import {
  routePathOf,
  routePrefixOf,
  sourceFilePathOf,
  sourceVersionPrefixOf,
} from '@dltech/atlas-artifacts'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import {
  artifactGetOutputSchema,
  artifactListOutputSchema,
  artifactSourceExportOutputSchema,
} from '@dltech/atlas-wire'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { dataOf, trpcQuery } from '../session-trpc-test-app'
import { FakeArtifactBlobStore } from './artifact-blob-store.fakes'
import {
  ARTIFACT_DOMAIN,
  beginPublish,
  buildArtifactsApp,
  OWNER,
  publishArtifact,
  subdomainOf,
  withSubdomain,
} from './artifacts.router.fixture'

describe('ArtifactsRouter library', () => {
  useTestDatabase()
  let app: INestApplication
  const blobs = new FakeArtifactBlobStore()

  const get = (token: string, subdomain: string) =>
    trpcQuery({ app, path: 'artifacts.get', token, input: { subdomain } })
  const list = (token: string) => trpcQuery({ app, path: 'artifacts.list', token })
  const sourceExport = (token: string, subdomain: string) =>
    trpcQuery({ app, path: 'artifacts.sourceExport', token, input: { subdomain } })

  beforeEach(async () => {
    await seedSessionUsers()
    blobs.reset()
    app = await buildArtifactsApp({ blobs })
  })

  afterEach(() => app.close())

  it('projects the live version, its serve rules and its stored log', async () => {
    const published = await publishArtifact({ app, blobs })

    const detail = artifactGetOutputSchema.parse(
      dataOf((await get(OWNER, published.subdomain)).body),
    )

    expect(detail.artifact.status).toBe('ready')
    expect(detail.build).toMatchObject({ failure: null, log: null, durationMs: null })
    expect(blobs.bodyOf(routePathOf({ id: published.subdomain }))).toMatchObject({ version: 1 })
  })

  describe('artifacts.list and artifacts.get', () => {
    it('lists published artifacts with their live URL, status and update time', async () => {
      const published = await publishArtifact({ app, blobs })

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

    it('keeps reporting the live version while a newer one is still uploading', async () => {
      const published = await publishArtifact({ app, blobs })
      await beginPublish({ app, input: withSubdomain(published.subdomain) })

      const detail = artifactGetOutputSchema.parse(
        dataOf((await get('sandbox-token-a', published.subdomain)).body),
      )

      expect(detail.artifact.status).toBe('ready')
      expect(detail.build.status).toBe('ready')
    })

    it('answers 404 for an unknown subdomain and for another user', async () => {
      const published = await publishArtifact({ app, blobs })

      expect((await get(OWNER, 'missing')).status).toBe(404)
      expect((await get('session-b', published.subdomain)).status).toBe(404)
    })
  })

  describe('artifacts.sourceExport', () => {
    it('signs a readable GET for every file of the live version', async () => {
      const first = await publishArtifact({ app, blobs })
      const second = await publishArtifact({
        app,
        blobs,
        input: withSubdomain(first.subdomain),
      })

      const exported = artifactSourceExportOutputSchema.parse(
        dataOf((await sourceExport(OWNER, first.subdomain)).body),
      )

      expect(second.version).toBe(2)
      expect(exported.entries.map((entry) => entry.path)).toEqual(['app.css', 'index.html'])
      expect(exported.entries[1]?.url).toBe(
        `https://blob.test/get/${sourceFilePathOf({ id: first.subdomain, version: 2, path: 'index.html' })}?ttl=3600000`,
      )
    })

    it("ignores another version's folder", async () => {
      const published = await publishArtifact({ app, blobs })
      blobs.seed({
        pathname: sourceFilePathOf({ id: published.subdomain, version: 7, path: 'later.html' }),
      })

      const exported = artifactSourceExportOutputSchema.parse(
        dataOf((await sourceExport(OWNER, published.subdomain)).body),
      )

      expect(exported.entries.map((entry) => entry.path)).toEqual(['app.css', 'index.html'])
      expect(
        [...blobs.stored.keys()].filter((key) =>
          key.startsWith(sourceVersionPrefixOf({ id: published.subdomain, version: 7 })),
        ),
      ).toHaveLength(1)
    })

    it('falls back to the legacy unversioned keys of an artifact published before versions', async () => {
      const granted = await beginPublish({ app })
      const subdomain = await subdomainOf(granted.artifactId)
      blobs.seed({ pathname: `artifacts/${subdomain}/_source/index.html`, body: 'legacy' })
      blobs.seed({ pathname: `artifacts/${subdomain}/_source/v1/index.html`, body: 'versioned' })

      const exported = artifactSourceExportOutputSchema.parse(
        dataOf((await sourceExport(OWNER, subdomain)).body),
      )

      expect(exported.entries.map((entry) => entry.path)).toEqual(['index.html'])
      expect(exported.entries[0]?.url).toBe(
        `https://blob.test/get/artifacts/${subdomain}/_source/index.html?ttl=3600000`,
      )
    })

    it('answers 404 when the artifact holds no source at all', async () => {
      const granted = await beginPublish({ app })
      const subdomain = await subdomainOf(granted.artifactId)

      expect((await sourceExport(OWNER, subdomain)).status).toBe(404)
      expect(
        [...blobs.stored.keys()].filter((key) => key.includes(routePrefixOf({ id: subdomain }))),
      ).toEqual([])
    })

    it("refuses another user's artifact", async () => {
      const published = await publishArtifact({ app, blobs })

      expect((await sourceExport('session-b', published.subdomain)).status).toBe(404)
    })
  })
})
