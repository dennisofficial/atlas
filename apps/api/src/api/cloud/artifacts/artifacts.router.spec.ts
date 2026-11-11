import type { INestApplication } from '@nestjs/common'
import { blobPathOf } from '@dltech/atlas-artifacts'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import {
  artifactBeginPublishOutputSchema,
  artifactGetOutputSchema,
  artifactListOutputSchema,
  artifactSourceExportOutputSchema,
} from '@dltech/atlas-wire'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { buildSessionTrpcApp, dataOf, trpcMutation, trpcQuery } from '../session-trpc-test-app'
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
  DEFAULT_INPUT,
  OWNER,
  SRC_INDEX,
  SRC_STYLE,
  publishArtifact,
  seedUploads,
  withSlug,
} from './artifacts.router.fixture'

describe('ArtifactsRouter', () => {
  const database = useTestDatabase()
  let app: INestApplication
  const blobs = new FakeArtifactBlobStore()
  const retention = new ArtifactRetention(blobs)
  const sandbox = new FakeArtifactSandbox()

  const begin = (token: string, input: unknown = DEFAULT_INPUT) =>
    trpcMutation({ app, path: 'artifacts.beginPublish', token, input })
  const commit = (token: string, input: unknown) =>
    trpcMutation({ app, path: 'artifacts.commitPublish', token, input })
  const list = (token: string) => trpcQuery({ app, path: 'artifacts.list', token })
  const get = (token: string, slug: string) =>
    trpcQuery({ app, path: 'artifacts.get', token, input: { slug } })
  const sourceExport = (token: string, slug: string) =>
    trpcQuery({ app, path: 'artifacts.sourceExport', token, input: { slug } })

  const beginOf = async (token: string, input: unknown = DEFAULT_INPUT) =>
    artifactBeginPublishOutputSchema.parse(dataOf((await begin(token, input).expect(200)).body))

  const publish = (token = OWNER, input: unknown = DEFAULT_INPUT) =>
    publishArtifact({ app, blobs, token, input })
  const seedAll = () =>
    seedUploads({ blobs, shas: DEFAULT_INPUT.entries.map((entry) => entry.sha256) })

  beforeEach(async () => {
    await seedSessionUsers()
    blobs.reset()
    sandbox.reset()
    app = await buildArtifactsApp({ blobs, retention, sandbox })
  })

  afterEach(() => app.close())

  describe('artifacts.beginPublish', () => {
    it('mints an artifact and presigns every missing blob for a session', async () => {
      const res = await begin(OWNER).expect(200)

      expect(res.headers['cache-control']).toBe('no-store')
      const grant = artifactBeginPublishOutputSchema.parse(dataOf(res.body))
      expect(grant).toMatchObject({ slug: 'demo', version: 1 })
      expect(grant.token).toMatch(/^[a-z0-9]{8}$/)
      expect(grant.uploads.map((upload) => upload.sha256)).toEqual([
        SRC_INDEX.sha256,
        SRC_STYLE.sha256,
      ])
      expect(grant.uploads[0]?.url).toBe(`https://blob.test/put/${blobPathOf(SRC_INDEX.sha256)}`)
    })

    it('skips an upload the pool already holds', async () => {
      const first = await beginOf(OWNER)
      blobs.seed({ pathname: blobPathOf(SRC_INDEX.sha256), body: 'cached' })

      const second = await beginOf(OWNER, withSlug('demo'))

      expect(second.artifactId).toBe(first.artifactId)
      expect(second.version).toBe(2)
      expect(second.uploads.map((upload) => upload.sha256)).toEqual([SRC_STYLE.sha256])
    })

    it('accepts a sandbox token', async () => {
      const res = await begin('sandbox-token-a').expect(200)

      expect(artifactBeginPublishOutputSchema.parse(dataOf(res.body)).slug).toBe('demo')
    })

    it('rejects an over-limit publish and a path outside the tree', async () => {
      const many = Array.from({ length: 2001 }, (_, index) => ({
        ...SRC_INDEX,
        path: `file-${index}.html`,
      }))

      expect((await begin(OWNER, { name: 'big', entries: many })).status).toBe(400)
      expect(
        (await begin(OWNER, { name: 'bad', entries: [{ ...SRC_INDEX, path: '../secret' }] }))
          .status,
      ).toBe(400)
      expect(await db.orm.public.ArtifactVersion.where((row) => row.id.neq('')).all()).toHaveLength(
        0,
      )
    })

    it("rejects an unknown slug and another user's slug", async () => {
      await publish()

      expect((await begin(OWNER, withSlug('missing'))).status).toBe(404)
      expect((await begin('session-b', withSlug('demo'))).status).toBe(404)
    })

    it('requires a bearer', async () => {
      await trpcMutation({ app, path: 'artifacts.beginPublish', input: DEFAULT_INPUT }).expect(401)
    })
  })

  describe('artifacts.commitPublish', () => {
    it('serves a no-build version from its own source tree', async () => {
      const published = await publish()
      const detail = artifactGetOutputSchema.parse(dataOf((await get(OWNER, 'demo')).body))

      expect(detail.current.map((entry) => `${entry.tree}/${entry.path}`)).toEqual([
        'src/index.html',
        'src/app.css',
        'dist/index.html',
        'dist/app.css',
      ])
      expect(detail.artifact).toMatchObject({ currentVersion: 1, status: 'ready', fileCount: 4 })
      expect(detail.artifact.url).toBe(`https://${published.token}-demo.artifacts.test`)
    })

    it('rejects a missing upload', async () => {
      const granted = await beginOf(OWNER)

      const missing = await commit(OWNER, {
        artifactId: granted.artifactId,
        version: granted.version,
        spec: {},
      })

      expect(missing.status).toBe(400)
      expect(Reflect.get(missing.body, 'error')).toMatchObject({
        message: expect.stringContaining('src/index.html'),
      })
    })

    it('builds a spec with a build block and serves the built tree', async () => {
      await publish()
      const granted = await beginOf('sandbox-token-a', withSlug('demo'))
      seedAll()
      sandbox.scripted(
        sandboxResult({
          install: finishedCommand({ stdout: 'installed' }),
          outDir: builtFiles([
            { path: 'index.html', body: '<h1>built</h1>' },
            { path: 'assets/app.js', body: 'void 0' },
          ]),
        }),
      )

      const res = await commit('sandbox-token-a', {
        artifactId: granted.artifactId,
        version: granted.version,
        spec: { build: { install: 'bun install', cmd: 'bun run build', outDir: 'dist' } },
      }).expect(200)

      expect(dataOf(res.body)).toMatchObject({ version: 2, status: 'ready' })
      const detail = artifactGetOutputSchema.parse(dataOf((await get(OWNER, 'demo')).body))
      expect(detail.current.map((entry) => `${entry.tree}/${entry.path}`)).toEqual([
        'src/index.html',
        'src/app.css',
        'dist/assets/app.js',
        'dist/index.html',
      ])
      const stored = await db.orm.public.ArtifactVersion.first({
        artifactId: granted.artifactId,
        version: 2,
      })
      expect(stored).toMatchObject({ status: 'ready', fileCount: 4 })
      expect(stored?.log).toContain('installed')
    })

    it('fails the version and leaves currentVersion on a failed build', async () => {
      await publish()
      const granted = await beginOf('sandbox-token-a', withSlug('demo'))
      seedAll()
      sandbox.scripted(
        sandboxResult({
          build: finishedCommand({ exitCode: 1, stderr: 'TS2304: cannot find name' }),
        }),
      )

      const res = await commit('sandbox-token-a', {
        artifactId: granted.artifactId,
        version: granted.version,
        spec: { build: { cmd: 'bun run build', outDir: 'dist' } },
      }).expect(200)

      expect(dataOf(res.body)).toMatchObject({ version: 2, status: 'failed' })
      const artifact = await db.orm.public.Artifact.first({ id: granted.artifactId })
      expect(artifact?.currentVersion).toBe(1)
      const stored = await db.orm.public.ArtifactVersion.first({
        artifactId: granted.artifactId,
        version: 2,
      })
      expect(stored?.status).toBe('failed')
      expect(stored?.failure).toBe('build failed with exit code 1: TS2304: cannot find name')
      expect(stored?.log).toContain('==> build (exit 1)')
    })

    it('refuses a build published without a pod or sandbox token', async () => {
      const granted = await beginOf(OWNER)
      seedAll()

      const res = await commit(OWNER, {
        artifactId: granted.artifactId,
        version: granted.version,
        spec: { build: { cmd: 'bun run build', outDir: 'dist' } },
      })

      expect(res.status).toBe(400)
      expect(Reflect.get(res.body, 'error')).toMatchObject({
        message: expect.stringContaining('sandbox or pod token'),
      })
      expect(sandbox.requests).toHaveLength(0)
    })

    it("refuses another user's artifact", async () => {
      const granted = await beginOf(OWNER)
      seedAll()

      const res = await commit('session-b', {
        artifactId: granted.artifactId,
        version: granted.version,
        spec: {},
      })

      expect(res.status).toBe(404)
    })
  })

  describe('artifacts.list and artifacts.get', () => {
    it('lists published artifacts with their served status', async () => {
      await publish()

      const res = await list(OWNER).expect(200)
      const [summary] = artifactListOutputSchema.parse(dataOf(res.body)).artifacts

      expect(summary).toMatchObject({
        slug: 'demo',
        name: 'demo',
        currentVersion: 1,
        status: 'ready',
        bytes: 34,
        fileCount: 4,
      })
      const empty = artifactListOutputSchema.parse(dataOf((await list('session-b')).body))
      expect(empty.artifacts).toEqual([])
    })

    it('returns artifact, versions and manifest in one call for a sandbox', async () => {
      await publish()
      await publish(OWNER, withSlug('demo'))

      const res = await get('sandbox-token-a', 'demo').expect(200)
      const detail = artifactGetOutputSchema.parse(dataOf(res.body))

      expect(detail.versions.map((version) => version.version)).toEqual([2, 1])
      expect(detail.current).toHaveLength(4)
      expect(detail.artifact.status).toBe('ready')
    })

    it('answers 404 for an unknown slug and for another user', async () => {
      await publish()

      expect((await get(OWNER, 'missing')).status).toBe(404)
      expect((await get('session-b', 'demo')).status).toBe(404)
    })
  })

  describe('artifacts.sourceExport', () => {
    it('signs a GET for every source entry and only those', async () => {
      await publish()

      const res = await sourceExport(OWNER, 'demo').expect(200)
      const exported = artifactSourceExportOutputSchema.parse(dataOf(res.body))

      expect(exported.entries.map((entry) => entry.path)).toEqual(['index.html', 'app.css'])
      expect(exported.entries[0]?.url).toBe(
        `https://blob.test/get/${blobPathOf(SRC_INDEX.sha256)}?ttl=3600000`,
      )
    })

    it("refuses another user's artifact", async () => {
      await publish()

      expect((await sourceExport('session-b', 'demo')).status).toBe(404)
    })
  })
})
