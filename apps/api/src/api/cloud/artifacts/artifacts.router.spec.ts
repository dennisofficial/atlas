import type { INestApplication } from '@nestjs/common'
import { SPEC_FILE_NAME, sha256Hex, sourcePathOf, sourcePrefixOf } from '@dltech/atlas-artifacts'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { artifactBeginPublishOutputSchema, artifactGetOutputSchema } from '@dltech/atlas-wire'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { dataOf, trpcMutation, trpcQuery } from '../session-trpc-test-app'
import { FakeArtifactBlobStore } from './artifact-blob-store.fakes'
import { FakeArtifactSandbox } from './artifact-sandbox.fakes'
import {
  buildArtifactsApp,
  DEFAULT_INPUT,
  FakeArtifactJobDispatcher,
  OWNER,
  publishArtifact,
  seedSources,
  subdomainOf,
  withSubdomain,
} from './artifacts.router.fixture'

describe('ArtifactsRouter', () => {
  useTestDatabase()
  let app: INestApplication
  const blobs = new FakeArtifactBlobStore()
  const sandbox = new FakeArtifactSandbox()
  const jobs = new FakeArtifactJobDispatcher()

  const begin = (token: string, input: unknown = DEFAULT_INPUT) =>
    trpcMutation({ app, path: 'artifacts.beginPublish', token, input })
  const commit = (token: string, input: unknown) =>
    trpcMutation({ app, path: 'artifacts.commitPublish', token, input })
  const get = (token: string, subdomain: string) =>
    trpcQuery({ app, path: 'artifacts.get', token, input: { subdomain } })

  const keysUnder = (prefix: string): string[] =>
    [...blobs.stored.keys()].filter((key) => key.startsWith(prefix)).sort()

  const publish = (
    args: {
      input?: unknown
      bodies?: Record<string, string>
      bodySpec?: unknown
      drain?: boolean
    } = {},
  ) => publishArtifact({ app, blobs, sandbox, jobs, ...args })

  const seedGranted = async (granted: {
    artifactId: string
    uploads: readonly { path: string }[]
  }): Promise<void> =>
    seedSources({
      blobs,
      artifactId: granted.artifactId,
      paths: granted.uploads.map((upload) => upload.path),
    })

  beforeEach(async () => {
    await seedSessionUsers()
    blobs.reset()
    sandbox.reset()
    jobs.reset()
    app = await buildArtifactsApp({ blobs, jobs })
  })

  afterEach(() => app.close())

  describe('artifacts.beginPublish', () => {
    it('mints a hostname-safe subdomain and presigns the source tree under it', async () => {
      const res = await begin(OWNER).expect(200)

      const grant = artifactBeginPublishOutputSchema.parse(dataOf(res.body))
      const subdomain = await subdomainOf(grant.artifactId)
      expect(grant).toMatchObject({ subdomain: subdomain, version: 1 })
      expect(grant.uploads.map((upload) => upload.path)).toEqual(['index.html', 'app.css'])
      expect(subdomain).toMatch(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/)
      expect(grant.uploads[0]?.url).toBe(
        `https://blob.test/put/${sourcePathOf({ id: subdomain, path: 'index.html' })}`,
      )
    })

    it('accepts a sandbox token', async () => {
      const res = await begin('sandbox-token-a').expect(200)
      const grant = artifactBeginPublishOutputSchema.parse(dataOf(res.body))
      expect(grant.subdomain).toBe(await subdomainOf(grant.artifactId))
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
      const published = await publish()

      expect((await begin(OWNER, withSubdomain('missing'))).status).toBe(404)
      expect((await begin('session-b', withSubdomain(published.subdomain))).status).toBe(404)
    })

    it('requires a bearer', async () => {
      await trpcMutation({ app, path: 'artifacts.beginPublish', input: DEFAULT_INPUT }).expect(401)
    })
  })

  describe('artifacts.commitPublish', () => {
    it('stores the source, dispatches one build and answers building at once', async () => {
      const granted = artifactBeginPublishOutputSchema.parse(
        dataOf((await begin(OWNER).expect(200)).body),
      )
      await seedGranted(granted)
      const subdomain = await subdomainOf(granted.artifactId)
      const source = sourcePrefixOf({ id: subdomain })
      blobs.seed({ pathname: `${source}stale.html`, body: 'stale' })

      const res = await commit(OWNER, {
        artifactId: granted.artifactId,
        version: granted.version,
      }).expect(200)

      expect(dataOf(res.body)).toMatchObject({
        subdomain,
        version: granted.version,
        status: 'building',
      })
      expect(jobs.calls).toHaveLength(1)
      expect(jobs.calls[0]).toMatchObject({
        taskId: 'artifact-build',
        payload: {
          artifactId: granted.artifactId,
          version: granted.version,
          userId: 'user-a',
        },
        idempotencyKey: `artifact-build:${granted.artifactId}:${granted.version}`,
        tags: [`artifact:${subdomain}`],
      })
      expect(keysUnder(source)).toEqual([`${source}app.css`, `${source}index.html`])
      expect(blobs.stored.has(`${source}stale.html`)).toBe(false)
      expect([...blobs.stored.keys()].filter((key) => key.includes('/_route/'))).toEqual([])
    })

    it('carries the pushing thread on a sandbox publish', async () => {
      const granted = artifactBeginPublishOutputSchema.parse(
        dataOf((await begin('sandbox-token-a').expect(200)).body),
      )
      await seedGranted(granted)

      await commit('sandbox-token-a', {
        artifactId: granted.artifactId,
        version: granted.version,
      }).expect(200)

      expect(jobs.calls[0]?.payload).toMatchObject({ threadId: 'thread-a' })
    })

    it('reads the build spec from the pushed artifact.json and ignores body.spec', async () => {
      const pushed = { build: { cmd: 'bun run build', outDir: 'dist' }, serve: { spa: true } }
      const published = await publish({
        input: {
          name: 'demo',
          entries: [
            ...DEFAULT_INPUT.entries,
            {
              ...DEFAULT_INPUT.entries[0],
              path: SPEC_FILE_NAME,
              type: 'application/json',
              size: Buffer.byteLength(JSON.stringify(pushed)),
              sha256: sha256Hex(Buffer.from(JSON.stringify(pushed))),
            },
          ],
        },
        bodies: {
          'index.html': '<h1>hello</h1>',
          'app.css': 'h1{color:red}',
          [SPEC_FILE_NAME]: JSON.stringify(pushed),
        },
        bodySpec: { serve: { spa: false } },
        drain: false,
      })
      const row = await db.orm.public.ArtifactVersion.first({
        artifactId: published.artifactId,
        version: published.version,
      })

      expect(row?.spec).toMatchObject({ serve: { spa: true } })
    })

    it('rejects a missing upload and dispatches nothing', async () => {
      const granted = artifactBeginPublishOutputSchema.parse(
        dataOf((await begin(OWNER).expect(200)).body),
      )

      const missing = await commit(OWNER, {
        artifactId: granted.artifactId,
        version: granted.version,
      })

      expect(missing.status).toBe(400)
      expect(Reflect.get(missing.body, 'error')).toMatchObject({
        message: expect.stringContaining('index.html'),
      })
      expect(jobs.calls).toHaveLength(0)
    })

    it('records the version failed when the build cannot be dispatched', async () => {
      const granted = artifactBeginPublishOutputSchema.parse(
        dataOf((await begin(OWNER).expect(200)).body),
      )
      await seedGranted(granted)
      jobs.failWith = 'no such environment'

      const res = await commit(OWNER, {
        artifactId: granted.artifactId,
        version: granted.version,
      }).expect(200)

      expect(dataOf(res.body)).toMatchObject({ status: 'failed' })
      const detail = artifactGetOutputSchema.parse(
        dataOf((await get(OWNER, granted.subdomain)).body),
      )
      expect(detail.build).toMatchObject({
        status: 'failed',
        failure:
          'could not start the build: dispatching artifact-build failed: no such environment',
      })
    })

    it('supersedes an older version that is still building', async () => {
      const first = artifactBeginPublishOutputSchema.parse(
        dataOf((await begin(OWNER).expect(200)).body),
      )
      const second = artifactBeginPublishOutputSchema.parse(
        dataOf((await begin(OWNER, withSubdomain(first.subdomain)).expect(200)).body),
      )
      await seedGranted(second)

      await commit(OWNER, {
        artifactId: second.artifactId,
        version: second.version,
      }).expect(200)

      const older = await db.orm.public.ArtifactVersion.first({
        artifactId: first.artifactId,
        version: first.version,
      })
      expect(older?.status).toBe('superseded')
    })

    it("refuses another user's artifact", async () => {
      const granted = artifactBeginPublishOutputSchema.parse(
        dataOf((await begin(OWNER).expect(200)).body),
      )

      const res = await commit('session-b', {
        artifactId: granted.artifactId,
        version: granted.version,
      })

      expect(res.status).toBe(404)
    })
  })
})
