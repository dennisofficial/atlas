import type { INestApplication } from '@nestjs/common'
import { routePathOf, routePrefixOf, sourcePrefixOf } from '@dltech/atlas-artifacts'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { dataOf, trpcMutation } from '../session-trpc-test-app'
import { FakeArtifactBlobStore } from './artifact-blob-store.fakes'
import {
  buildArtifactsApp,
  DEFAULT_INPUT,
  OWNER,
  publishArtifact,
} from './artifacts.router.fixture'

describe('ArtifactsRouter lifecycle', () => {
  useTestDatabase()
  let app: INestApplication
  const blobs = new FakeArtifactBlobStore()

  const unpublish = (token: string, slug: string) =>
    trpcMutation({ app, path: 'artifacts.unpublish', token, input: { slug } })

  beforeEach(async () => {
    await seedSessionUsers()
    blobs.reset()
    app = await buildArtifactsApp({ blobs })
  })

  afterEach(() => app.close())

  describe('artifacts.unpublish', () => {
    it('removes the route object first, then both trees of that artifact', async () => {
      const published = await publishArtifact({ app, blobs })
      const route = routePrefixOf({ id: published.subdomain })
      const source = sourcePrefixOf({ id: published.subdomain })

      const res = await unpublish(OWNER, 'demo').expect(200)

      expect(dataOf(res.body)).toEqual({ ok: true })
      expect(blobs.deleted[0]).toBe(routePathOf({ id: published.subdomain }))
      expect(blobs.deleted).toContain(`${route}index.html`)
      expect(blobs.deleted).toContain(`${source}index.html`)
      expect([...blobs.stored.keys()].filter((key) => key.startsWith(route))).toEqual([])
      expect([...blobs.stored.keys()].filter((key) => key.startsWith(source))).toEqual([])
      expect(await db.orm.public.Artifact.where((row) => row.id.neq('')).all()).toHaveLength(0)
      expect(await db.orm.public.ArtifactVersion.where((row) => row.id.neq('')).all()).toHaveLength(
        0,
      )
    })

    it('keeps the bytes of another artifact under a different id', async () => {
      await publishArtifact({ app, blobs })
      const other = await publishArtifact({
        app,
        blobs,
        input: { ...DEFAULT_INPUT, name: 'other' },
      })

      await unpublish(OWNER, 'demo').expect(200)

      expect(
        [...blobs.stored.keys()].filter((key) =>
          key.startsWith(routePrefixOf({ id: other.subdomain })),
        ),
      ).toHaveLength(2)
    })

    it("refuses another user's artifact", async () => {
      await publishArtifact({ app, blobs })

      expect((await unpublish('session-b', 'demo')).status).toBe(404)
      expect(await db.orm.public.Artifact.where((row) => row.id.neq('')).all()).toHaveLength(1)
    })

    it('answers 404 for an unknown slug', async () => {
      expect((await unpublish(OWNER, 'missing')).status).toBe(404)
    })
  })
})
