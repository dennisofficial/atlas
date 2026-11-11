import type { INestApplication } from '@nestjs/common'
import { routePathOf, routePrefixOf, sourcePathOf, sourcePrefixOf } from '@dltech/atlas-artifacts'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import {
  artifactBeginPublishOutputSchema,
  artifactGetOutputSchema,
  artifactListOutputSchema,
  artifactRouteSchema,
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
  DEFAULT_INPUT,
  OWNER,
  SOURCE_BODIES,
  SRC_INDEX,
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

  const begin = (token: string, input: unknown = DEFAULT_INPUT) =>
    trpcMutation({ app, path: 'artifacts.beginPublish', token, input })
  const commit = (token: string, input: unknown) =>
    trpcMutation({ app, path: 'artifacts.commitPublish', token, input })
  const list = (token: string) => trpcQuery({ app, path: 'artifacts.list', token })
  const get = (token: string, subdomain: string) =>
    trpcQuery({ app, path: 'artifacts.get', token, input: { subdomain } })
  const sourceExport = (token: string, subdomain: string) =>
    trpcQuery({ app, path: 'artifacts.sourceExport', token, input: { subdomain } })

  const keysUnder = (prefix: string): string[] =>
    [...blobs.stored.keys()].filter((key) => key.startsWith(prefix)).sort()

  const publish = (args: { token?: string; input?: unknown; spec?: unknown } = {}) =>
    publishArtifact({ app, blobs, ...args })

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
    app = await buildArtifactsApp({ blobs, sandbox })
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
    it('writes both trees, the route object, and prunes what it did not write', async () => {
      const published = await publish()
      const route = routePrefixOf({ id: published.subdomain })
      const source = sourcePrefixOf({ id: published.subdomain })

      expect(keysUnder(route)).toEqual([`${route}app.css`, `${route}index.html`])
      expect(keysUnder(source)).toEqual([`${source}app.css`, `${source}index.html`])
      const routeObject = artifactRouteSchema.parse(
        blobs.bodyOf(routePathOf({ id: published.subdomain })),
      )
      expect(routeObject).toMatchObject({
        artifactId: published.artifactId,
        subdomain: published.subdomain,
        name: 'demo',
        serve: { spa: false },
      })

      blobs.seed({ pathname: `${route}stale.html`, body: 'stale' })
      blobs.seed({ pathname: `${source}stale.html`, body: 'stale' })
      await publish({ input: withSubdomain(published.subdomain) })

      expect(blobs.stored.has(`${route}stale.html`)).toBe(false)
      expect(blobs.stored.has(`${source}stale.html`)).toBe(false)
      expect(keysUnder(route)).toHaveLength(2)
    })

    it('serves the built output when the spec builds', async () => {
      const published = await publish()
      const granted = artifactBeginPublishOutputSchema.parse(
        dataOf(
          (await begin('sandbox-token-a', withSubdomain(published.subdomain)).expect(200)).body,
        ),
      )
      await seedGranted(granted)
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
      const subdomain = await subdomainOf(granted.artifactId)
      const route = routePrefixOf({ id: subdomain })
      expect(keysUnder(route)).toEqual([`${route}assets/app.js`, `${route}index.html`])
      expect((await blobs.read({ pathname: `${route}index.html` }))?.toString()).toBe(
        '<h1>built</h1>',
      )
      const detail = artifactGetOutputSchema.parse(
        dataOf((await get(OWNER, published.subdomain)).body),
      )
      expect(detail.build.log).toContain('installed')
      expect(detail.build.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('leaves the previous route tree and route object alone when the build fails', async () => {
      const published = await publish()
      const route = routePrefixOf({ id: published.subdomain })
      const before = keysUnder(route)
      const routeObjectBefore = blobs.stored.get(routePathOf({ id: published.subdomain }))?.body

      const granted = artifactBeginPublishOutputSchema.parse(
        dataOf(
          (await begin('sandbox-token-a', withSubdomain(published.subdomain)).expect(200)).body,
        ),
      )
      await seedGranted(granted)
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

      expect(dataOf(res.body)).toMatchObject({ status: 'failed' })
      expect(keysUnder(route)).toEqual(before)
      expect(blobs.stored.get(routePathOf({ id: published.subdomain }))?.body).toBe(
        routeObjectBefore,
      )
      const detail = artifactGetOutputSchema.parse(
        dataOf((await get(OWNER, published.subdomain)).body),
      )
      expect(detail.build).toMatchObject({
        status: 'failed',
        failure: 'build failed with exit code 1: TS2304: cannot find name',
      })
      expect(detail.build.log).toContain('==> build (exit 1)')
    })

    it('rejects a missing upload', async () => {
      const granted = artifactBeginPublishOutputSchema.parse(
        dataOf((await begin(OWNER).expect(200)).body),
      )

      const missing = await commit(OWNER, {
        artifactId: granted.artifactId,
        version: granted.version,
        spec: {},
      })

      expect(missing.status).toBe(400)
      expect(Reflect.get(missing.body, 'error')).toMatchObject({
        message: expect.stringContaining('index.html'),
      })
    })

    it('refuses a build published without a pod or sandbox token', async () => {
      const granted = artifactBeginPublishOutputSchema.parse(
        dataOf((await begin(OWNER).expect(200)).body),
      )
      await seedGranted(granted)

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
      const granted = artifactBeginPublishOutputSchema.parse(
        dataOf((await begin(OWNER).expect(200)).body),
      )

      const res = await commit('session-b', {
        artifactId: granted.artifactId,
        version: granted.version,
        spec: {},
      })

      expect(res.status).toBe(404)
    })
  })
})
