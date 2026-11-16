import type { INestApplication } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { trpcMutation } from '../session-trpc-test-app'
import { FakeArtifactBlobStore } from './artifact-blob-store.fakes'
import {
  beginPublish,
  buildArtifactsApp,
  DEFAULT_INPUT,
  DIST_INDEX,
  OWNER,
  publishArtifact,
  subdomainOf,
  withSubdomain,
} from './artifacts.router.fixture'

describe('ArtifactsRouter', () => {
  useTestDatabase()
  let app: INestApplication
  const blobs = new FakeArtifactBlobStore()

  const begin = (token: string, input: unknown = DEFAULT_INPUT) =>
    trpcMutation({ app, path: 'artifacts.beginPublish', token, input })

  const presignsOf = (subdomain: string): string[] =>
    blobs.requestedUploads.filter((pathname) => pathname.includes(subdomain))

  beforeEach(async () => {
    await seedSessionUsers()
    blobs.reset()
    app = await buildArtifactsApp({ blobs })
  })

  afterEach(() => app.close())

  describe('artifacts.beginPublish', () => {
    it('presigns every source file into both trees when the push has no output', async () => {
      const granted = await beginPublish({ app })
      const subdomain = await subdomainOf(granted.artifactId)

      expect(granted.version).toBe(1)
      expect(granted.uploads.map((upload) => `${upload.tree}/${upload.path}`).sort()).toEqual([
        'dist/app.css',
        'dist/index.html',
        'src/app.css',
        'src/index.html',
      ])
      expect(presignsOf(subdomain).sort()).toEqual([
        `artifacts/${subdomain}/_route/v1/app.css`,
        `artifacts/${subdomain}/_route/v1/index.html`,
        `artifacts/${subdomain}/_source/v1/app.css`,
        `artifacts/${subdomain}/_source/v1/index.html`,
      ])
      const source = granted.uploads.find((upload) => upload.tree === 'src')
      const mirror = granted.uploads.find((upload) => upload.tree === 'dist')
      expect(mirror?.sha256).toBe(source?.sha256)
    })

    it('presigns only the dist files into the route tree when the push carries output', async () => {
      const granted = await beginPublish({
        app,
        input: { name: 'built', entries: [DEFAULT_INPUT.entries[0], DIST_INDEX] },
      })
      const subdomain = await subdomainOf(granted.artifactId)

      expect(presignsOf(subdomain).sort()).toEqual([
        `artifacts/${subdomain}/_route/v1/index.html`,
        `artifacts/${subdomain}/_source/v1/index.html`,
      ])
    })

    it('accepts a sandbox token', async () => {
      const granted = await beginPublish({ app, token: 'sandbox-token-a' })
      expect(granted.subdomain).toBe(await subdomainOf(granted.artifactId))
    })

    it('rejects an over-limit publish and a path outside the tree', async () => {
      const many = Array.from({ length: 2001 }, (_, index) => ({
        ...DEFAULT_INPUT.entries[0],
        path: `file-${index}.html`,
      }))

      expect((await begin(OWNER, { name: 'big', entries: many })).status).toBe(400)
      expect(
        (
          await begin(OWNER, {
            name: 'bad',
            entries: [{ ...DEFAULT_INPUT.entries[0], path: '../secret' }],
          })
        ).status,
      ).toBe(400)
      expect(await db.orm.public.ArtifactVersion.where((row) => row.id.neq('')).all()).toHaveLength(
        0,
      )
    })

    it("rejects an unknown subdomain and another user's subdomain", async () => {
      const published = await publishArtifact({ app, blobs })

      expect((await begin(OWNER, withSubdomain('missing'))).status).toBe(404)
      expect((await begin('session-b', withSubdomain(published.subdomain))).status).toBe(404)
    })

    it('requires a bearer', async () => {
      await trpcMutation({ app, path: 'artifacts.beginPublish', input: DEFAULT_INPUT }).expect(401)
    })
  })
})
