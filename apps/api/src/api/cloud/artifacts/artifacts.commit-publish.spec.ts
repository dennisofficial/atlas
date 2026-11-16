import type { INestApplication } from '@nestjs/common'
import {
  routeFilePathOf,
  routePathOf,
  sourceFilePathOf,
  SPEC_FILE_NAME,
} from '@dltech/atlas-artifacts'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { dataOf, trpcMutation } from '../session-trpc-test-app'
import { FakeArtifactBlobStore } from './artifact-blob-store.fakes'
import {
  ARTIFACT_DOMAIN,
  beginPublish,
  BUILD_SPEC,
  BUILD_SPEC_ENTRY,
  buildArtifactsApp,
  DEFAULT_INPUT,
  OWNER,
  publishArtifact,
  seedUploads,
  SOURCE_BODIES,
  SPEC_ENTRY,
  subdomainOf,
  withSubdomain,
} from './artifacts.router.fixture'
import { SERVER_BUILD_GONE } from './artifacts.service'

describe('ArtifactsRouter commitPublish', () => {
  useTestDatabase()
  let app: INestApplication
  const blobs = new FakeArtifactBlobStore()

  const commit = (token: string, input: unknown) =>
    trpcMutation({ app, path: 'artifacts.commitPublish', token, input })

  beforeEach(async () => {
    await seedSessionUsers()
    blobs.reset()
    app = await buildArtifactsApp({ blobs })
  })

  afterEach(() => app.close())

  describe('commitPublish', () => {
    it('makes the version live at once and stores its log and duration', async () => {
      const granted = await beginPublish({ app })
      const subdomain = await subdomainOf(granted.artifactId)
      seedUploads({ blobs, granted: { ...granted, subdomain }, bodies: SOURCE_BODIES })

      const res = await commit(OWNER, {
        artifactId: granted.artifactId,
        version: granted.version,
        log: 'bun run build\nbuilt in 4.2s',
        durationMs: 4200,
      }).expect(200)

      expect(dataOf(res.body)).toEqual({
        subdomain,
        version: 1,
        url: `https://${subdomain}.${ARTIFACT_DOMAIN}`,
        status: 'ready',
      })
      expect(blobs.bodyOf(routePathOf({ id: subdomain }))).toMatchObject({
        version: 1,
        serve: { spa: false },
      })
      const row = await db.orm.public.ArtifactVersion.first({
        artifactId: granted.artifactId,
        version: 1,
      })
      expect(row).toMatchObject({
        status: 'ready',
        log: 'bun run build\nbuilt in 4.2s',
        durationMs: 4200,
        fileCount: 2,
      })
    })

    it('refuses a missing upload and makes nothing live', async () => {
      const granted = await beginPublish({ app })
      const subdomain = await subdomainOf(granted.artifactId)

      const missing = await commit(OWNER, {
        artifactId: granted.artifactId,
        version: granted.version,
      })

      expect(missing.status).toBe(400)
      expect(Reflect.get(missing.body, 'error')).toMatchObject({
        message: expect.stringContaining('no uploaded file for src/index.html'),
      })
      expect(blobs.stored.has(routePathOf({ id: subdomain }))).toBe(false)
    })

    it('rejects an artifact.json it cannot parse', async () => {
      const granted = await beginPublish({
        app,
        input: { name: 'demo', entries: [...DEFAULT_INPUT.entries, SPEC_ENTRY] },
      })
      const subdomain = await subdomainOf(granted.artifactId)
      seedUploads({
        blobs,
        granted: { ...granted, subdomain },
        bodies: { ...SOURCE_BODIES, [SPEC_FILE_NAME]: '{not json' },
      })

      const res = await commit(OWNER, { artifactId: granted.artifactId, version: 1 })

      expect(res.status).toBe(400)
      expect(Reflect.get(res.body, 'error')).toMatchObject({
        message: expect.stringContaining(`${SPEC_FILE_NAME} is not valid JSON`),
      })
    })

    it('refuses a build block with no output and records the row failed', async () => {
      const granted = await beginPublish({
        app,
        input: { name: 'demo', entries: [...DEFAULT_INPUT.entries, BUILD_SPEC_ENTRY] },
      })
      const subdomain = await subdomainOf(granted.artifactId)
      seedUploads({
        blobs,
        granted: { ...granted, subdomain },
        bodies: { ...SOURCE_BODIES, [SPEC_FILE_NAME]: JSON.stringify(BUILD_SPEC) },
      })

      const res = await commit(OWNER, { artifactId: granted.artifactId, version: 1 })

      expect(res.status).toBe(400)
      expect(Reflect.get(res.body, 'error')).toMatchObject({
        message: SERVER_BUILD_GONE,
      })
      const row = await db.orm.public.ArtifactVersion.first({
        artifactId: granted.artifactId,
        version: 1,
      })
      expect(row).toMatchObject({ status: 'failed', failure: SERVER_BUILD_GONE })
      expect(blobs.stored.has(routePathOf({ id: subdomain }))).toBe(false)
    })

    it('reads the serve rules from the pushed artifact.json and ignores body.spec', async () => {
      const published = await publishArtifact({
        app,
        blobs,
        buildSpec: { serve: { spa: true } },
        bodySpec: { serve: { spa: false } },
      })
      const row = await db.orm.public.ArtifactVersion.first({
        artifactId: published.artifactId,
        version: published.version,
      })

      expect(row?.spec).toMatchObject({ serve: { spa: true } })
      expect(blobs.bodyOf(routePathOf({ id: published.subdomain }))).toMatchObject({
        serve: { spa: true },
      })
    })

    it('refuses a version an equal or newer one already replaced', async () => {
      const first = await beginPublish({ app })
      const subdomain = await subdomainOf(first.artifactId)
      const second = await beginPublish({ app, input: withSubdomain(subdomain) })
      for (const granted of [first, second]) {
        seedUploads({ blobs, granted: { ...granted, subdomain }, bodies: SOURCE_BODIES })
      }
      await commit(OWNER, { artifactId: second.artifactId, version: second.version }).expect(200)

      const res = await commit(OWNER, {
        artifactId: first.artifactId,
        version: first.version,
      })

      expect(res.status).toBe(409)
      expect(Reflect.get(res.body, 'error')).toMatchObject({
        message: expect.stringContaining(
          `version 1 is older than the live version 2 of ${subdomain}`,
        ),
      })
      expect(blobs.bodyOf(routePathOf({ id: subdomain }))).toMatchObject({ version: 2 })
    })

    it('removes the folders of a version whose uploads finished after a newer commit', async () => {
      const first = await beginPublish({ app })
      const subdomain = await subdomainOf(first.artifactId)
      const second = await beginPublish({ app, input: withSubdomain(subdomain) })
      seedUploads({ blobs, granted: { ...second, subdomain }, bodies: SOURCE_BODIES })
      await commit(OWNER, { artifactId: second.artifactId, version: second.version }).expect(200)

      seedUploads({ blobs, granted: { ...first, subdomain }, bodies: SOURCE_BODIES })
      const res = await commit(OWNER, { artifactId: first.artifactId, version: first.version })

      expect(res.status).toBe(409)
      expect([...blobs.stored.keys()].filter((key) => key.includes('/v1/'))).toEqual([])
      expect([...blobs.stored.keys()].filter((key) => key.includes('/v2/')).length).toBeGreaterThan(
        0,
      )
      expect(blobs.bodyOf(routePathOf({ id: subdomain }))).toMatchObject({ version: 2 })
    })

    it('treats a repeated commit of the live version as done and keeps its folders', async () => {
      const first = await publishArtifact({ app, blobs })
      const second = await publishArtifact({
        app,
        blobs,
        input: withSubdomain(first.subdomain),
      })

      const res = await commit(OWNER, {
        artifactId: second.artifactId,
        version: second.version,
      })

      expect(res.status).toBe(200)
      expect(blobs.bodyOf(routePathOf({ id: first.subdomain }))).toMatchObject({ version: 2 })
      expect([...blobs.stored.keys()].some((key) => key.includes('/_route/v2/'))).toBe(true)
      expect([...blobs.stored.keys()].some((key) => key.includes('/_source/v2/'))).toBe(true)
    })

    it('prunes older versions and legacy keys but keeps a newer in-flight folder', async () => {
      const first = await publishArtifact({ app, blobs })
      const subdomain = first.subdomain
      const second = await publishArtifact({
        app,
        blobs,
        input: withSubdomain(subdomain),
      })
      blobs.seed({ pathname: sourceFilePathOf({ id: subdomain, version: 3, path: 'later.html' }) })
      blobs.seed({ pathname: routeFilePathOf({ id: subdomain, version: 3, path: 'later.html' }) })
      blobs.seed({ pathname: `artifacts/${subdomain}/_source/legacy.html` })

      const third = await publishArtifact({ app, blobs, input: withSubdomain(subdomain) })

      expect(second.version).toBe(2)
      expect(third.version).toBe(3)
      expect(blobs.stored.has(`artifacts/${subdomain}/_source/legacy.html`)).toBe(false)
      expect([...blobs.stored.keys()].filter((key) => key.includes('/v1/'))).toEqual([])
      expect([...blobs.stored.keys()].filter((key) => key.includes('/v2/'))).toEqual([])
      expect([...blobs.stored.keys()].filter((key) => key.includes('/v3/')).length).toBeGreaterThan(
        0,
      )
    })

    it('still reports ready when the prune fails', async () => {
      const published = await publishArtifact({ app, blobs })
      blobs.beforeRemove(() => {
        throw new Error('r2 is having a day')
      })
      const second = await beginPublish({ app, input: withSubdomain(published.subdomain) })
      seedUploads({ blobs, granted: second, bodies: SOURCE_BODIES })

      const res = await commit(OWNER, { artifactId: second.artifactId, version: 2 }).expect(200)

      expect(dataOf(res.body)).toMatchObject({ status: 'ready', version: 2 })
    })

    it("refuses another user's artifact", async () => {
      const granted = await beginPublish({ app })

      const res = await commit('session-b', {
        artifactId: granted.artifactId,
        version: granted.version,
      })

      expect(res.status).toBe(404)
    })
  })
})
