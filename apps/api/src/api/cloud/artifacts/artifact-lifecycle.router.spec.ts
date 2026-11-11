import type { INestApplication } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { blobPathOf } from '@dltech/atlas-artifacts'
import { artifactBeginPublishOutputSchema, artifactRouteSchema } from '@dltech/atlas-wire'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { dataOf, trpcMutation } from '../session-trpc-test-app'
import { FakeArtifactBlobStore } from './artifact-blob-store.fakes'
import { ArtifactRetention, KEEP_VERSIONS } from './artifact-retention'
import {
  buildArtifactsApp,
  DEFAULT_INPUT,
  OWNER,
  SRC_INDEX,
  SRC_STYLE,
  publishArtifact,
  seedUploads,
  withSlug,
} from './artifacts.router.fixture'
import type { ArtifactRow } from './artifact-rows'

describe('ArtifactsRouter lifecycle', () => {
  useTestDatabase()
  let app: INestApplication
  const blobs = new FakeArtifactBlobStore()
  const retention = new ArtifactRetention(blobs)

  const rollback = (token: string, input: unknown) =>
    trpcMutation({ app, path: 'artifacts.rollback', token, input })
  const unpublish = (token: string, slug: string) =>
    trpcMutation({ app, path: 'artifacts.unpublish', token, input: { slug } })
  const beginOf = async (token: string, input: unknown = DEFAULT_INPUT) =>
    artifactBeginPublishOutputSchema.parse(
      dataOf(
        (await trpcMutation({ app, path: 'artifacts.beginPublish', token, input }).expect(200))
          .body,
      ),
    )
  const commitOf = (args: { artifactId: string; version: number; spec: unknown }) =>
    trpcMutation({ app, path: 'artifacts.commitPublish', token: OWNER, input: args }).expect(200)

  const publish = (token = OWNER) => publishArtifact({ app, blobs, token })
  const artifactRow = async (): Promise<ArtifactRow> => {
    const artifact = await db.orm.public.Artifact.first({ userId: 'user-a' })
    if (artifact === null) throw new Error('no artifact')
    return artifact
  }

  beforeEach(async () => {
    await seedSessionUsers()
    blobs.reset()
    app = await buildArtifactsApp({ blobs, retention })
  })

  afterEach(() => app.close())

  describe('artifacts.rollback', () => {
    it('moves the pointer back and rewrites the route object', async () => {
      await publish()
      await publish(OWNER)
      await trpcMutation({
        app,
        path: 'artifacts.beginPublish',
        token: OWNER,
        input: withSlug('demo'),
      }).expect(200)
      const first = await artifactRow()

      const res = await rollback(OWNER, { slug: 'demo', version: 1 }).expect(200)

      expect(dataOf(res.body)).toMatchObject({ version: 1 })
      expect((await artifactRow()).currentVersion).toBe(1)
      const route = artifactRouteSchema.parse(blobs.bodyOf(`routes/${first.token}-demo.json`))
      expect(route.version).toBe(1)
      expect(route.manifest).toHaveLength(4)
    })

    it("writes the rolled-back version's stored serve rules, not the newest", async () => {
      const first = await beginOf(OWNER)
      seedUploads({ blobs, shas: first.uploads.map((upload) => upload.sha256) })
      await commitOf({
        artifactId: first.artifactId,
        version: first.version,
        spec: { serve: { spa: true, notFound: 'index.html' } },
      })
      const second = await beginOf(OWNER, withSlug('demo'))
      await commitOf({
        artifactId: second.artifactId,
        version: second.version,
        spec: { serve: { spa: false } },
      })

      await rollback(OWNER, { slug: 'demo', version: 1 }).expect(200)

      const route = artifactRouteSchema.parse(blobs.bodyOf(`routes/${first.token}-demo.json`))
      expect(route.version).toBe(1)
      expect(route.serve).toEqual({ spa: true, notFound: 'index.html' })
    })

    it('refuses a version that does not exist', async () => {
      await publish()

      expect((await rollback(OWNER, { slug: 'demo', version: 9 })).status).toBe(404)
      expect((await rollback('session-b', { slug: 'demo', version: 1 })).status).toBe(404)
    })
  })

  describe('artifacts.unpublish', () => {
    it('deletes the artifact, its route object and its versions', async () => {
      const published = await publish()

      const res = await unpublish(OWNER, 'demo').expect(200)

      expect(dataOf(res.body)).toEqual({ ok: true })
      expect(await db.orm.public.Artifact.where((row) => row.id.neq('')).all()).toHaveLength(0)
      expect(await db.orm.public.ArtifactVersion.where((row) => row.id.neq('')).all()).toHaveLength(
        0,
      )
      expect(blobs.deleted).toContain(`routes/${published.token}-demo.json`)
    })

    it("refuses another user's artifact", async () => {
      await publish()

      expect((await unpublish('session-b', 'demo')).status).toBe(404)
      expect(await db.orm.public.Artifact.where((row) => row.id.neq('')).all()).toHaveLength(1)
    })
  })

  describe('ArtifactRetention', () => {
    it('keeps the newest versions and the current one, and drops the rest', async () => {
      const artifact = await seedArtifact({ currentVersion: 1 })
      for (let version = 1; version <= KEEP_VERSIONS + 2; version++) {
        await seedVersion({ artifactId: artifact.id, version })
      }

      expect(await retention.prune({ artifactId: artifact.id })).toBe(1)
      const versions = await db.orm.public.ArtifactVersion.where({ artifactId: artifact.id }).all()
      expect(versions.map((row) => row.version)).toContain(1)
      expect(versions).toHaveLength(KEEP_VERSIONS + 1)
    })

    it('deletes every blob no surviving manifest references', async () => {
      const artifact = await seedArtifact({ currentVersion: 1 })
      await seedVersion({ artifactId: artifact.id, version: 1 })
      for (const entry of [SRC_INDEX, SRC_STYLE]) {
        blobs.seed({ pathname: blobPathOf(entry.sha256), body: entry.sha256 })
      }
      blobs.seed({ pathname: blobPathOf('c'.repeat(64)), body: 'orphan' })

      expect(await retention.collectGarbage()).toBe(1)
      expect([...blobs.stored.keys()].sort()).toEqual([
        blobPathOf(SRC_INDEX.sha256),
        blobPathOf(SRC_STYLE.sha256),
      ])
    })
  })

  const seedArtifact = async (args: { currentVersion: number }): Promise<ArtifactRow> =>
    db.orm.public.Artifact.create({
      id: `art-${Math.random().toString(36).slice(2)}`,
      userId: 'user-a',
      slug: 'seeded',
      token: 'k7f2m9qx',
      name: 'seeded',
      currentVersion: args.currentVersion,
    })

  const seedVersion = async (args: { artifactId: string; version: number }): Promise<void> => {
    await db.orm.public.ArtifactVersion.create({
      id: `ver-${args.artifactId}-${args.version}`,
      artifactId: args.artifactId,
      version: args.version,
      status: 'ready',
      manifest: [SRC_INDEX, SRC_STYLE],
      spec: {},
      sourceHash: 'a'.repeat(64),
      specHash: 'b'.repeat(64),
      bytes: 17,
      fileCount: 2,
    })
  }
})
