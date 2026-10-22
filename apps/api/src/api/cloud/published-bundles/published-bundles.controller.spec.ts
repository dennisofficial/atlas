import type { INestApplication } from '@nestjs/common'
import { UnauthorizedException, ValidationPipe, VersioningType } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { seedSessionUsers } from '../web-settings.fake-db'
import { bundlesOf, waitForBlockedInsert } from '../../../../test/fake-published-bundle-db'
import { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import { ETokenPrincipalKind } from '../../platform/sandboxes/token-principal'
import { SessionOrSandboxGuard } from '../../platform/sessions/session-or-sandbox.guard'
import { BundleBlobStore } from './blob-store'
import { PublishedBundlesController } from './published-bundles.controller'
import { FakeBundleBlobStore } from './published-bundles.fakes'
import { PublishedBundlesService } from './published-bundles.service'

const SESSIONS: Record<string, string> = { 'session-a': 'user-a', 'session-b': 'user-b' }
const POD_TOKENS: Record<string, { threadId: string; userId: string }> = {
  'pod-token-a': { threadId: 'thread-pod-a', userId: 'user-a' },
  'pod-token-c': { threadId: 'thread-pod-c', userId: 'user-c' },
}
const SHA = 'a'.repeat(64)
const MANIFEST = { skills: ['.agents/x'], instructions: ['ATLAS.md'], mcp: true }
const bearerOf = (req: { headers: { authorization?: string } }): string =>
  (req.headers.authorization ?? '').replace(/^Bearer /i, '')

describe('published bundles HTTP surface', () => {
  const database = useTestDatabase()
  let app: INestApplication
  const blobs = new FakeBundleBlobStore()
  const http = () => request(app.getHttpServer())
  const as = (token: string) => ({ authorization: `Bearer ${token}` })

  const upload = async (token: string): Promise<string> => {
    const issued = await http().post('/v1/published-bundles/uploads').set(as(token)).expect(201)
    const pathname = (issued.body as { pathname: string }).pathname
    blobs.uploaded.set(pathname, 1234)
    return pathname
  }
  const commit = async (token: string, overrides: Record<string, unknown> = {}) =>
    http()
      .post('/v1/published-bundles')
      .set(as(token))
      .send({ pathname: await upload(token), sha256: SHA, manifest: MANIFEST, ...overrides })

  beforeEach(async () => {
    await seedSessionUsers()
    blobs.reset()
    const module = await Test.createTestingModule({
      controllers: [PublishedBundlesController],
      providers: [
        PublishedBundlesService,
        SessionAuthGuard,
        SessionOrSandboxGuard,
        { provide: BundleBlobStore, useValue: blobs },
        {
          provide: SESSION_VERIFIER,
          useValue: {
            async verify(req: { headers: { authorization?: string } }) {
              const userId = SESSIONS[bearerOf(req)]
              if (userId === undefined) return null
              return { userId, sessionId: 'ses', email: '', activeOrganizationId: null }
            },
          },
        },
        {
          provide: SandboxesService,
          useValue: {
            async verifyTokenPrincipal(args: { token: string }) {
              const pod = POD_TOKENS[args.token]
              if (pod === undefined) throw new UnauthorizedException()
              return { kind: ETokenPrincipalKind.Pod, ...pod }
            },
            async assertThreadInFamily() {
              throw new Error('a pod principal must never reach the thread-family check')
            },
          },
        },
      ],
    }).compile()
    app = module.createNestApplication()
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()
  })

  afterEach(() => app.close())

  describe('POST /v1/published-bundles/uploads', () => {
    it('issues a pathname under the caller prefix to a session', async () => {
      const res = await http()
        .post('/v1/published-bundles/uploads')
        .set(as('session-a'))
        .expect(201)

      expect(res.headers['cache-control']).toBe('no-store')
      expect(res.body).toMatchObject({
        contentType: 'application/gzip',
        maximumSizeInBytes: 256 * 1024 * 1024,
      })
      expect(res.body.pathname).toMatch(/^bundles\/user-a\/[0-9a-f-]+\.tar\.gz$/)
      expect(res.body.uploadUrl).toBe(`https://blob.test/put/${res.body.pathname}`)
    })

    it('refuses a pod bearer and an anonymous caller', async () => {
      await http().post('/v1/published-bundles/uploads').set(as('pod-token-a')).expect(401)
      await http().post('/v1/published-bundles/uploads').expect(401)
      expect(blobs.presigned).toHaveLength(0)
    })
  })

  describe('POST /v1/published-bundles', () => {
    it('commits version 1 then version 2', async () => {
      const first = await commit('session-a')
      const second = await commit('session-a')

      expect(first.status).toBe(201)
      expect(first.body).toMatchObject({
        version: 1,
        sha256: SHA,
        sizeBytes: 1234,
        manifest: MANIFEST,
      })
      expect(second.status).toBe(201)
      expect(second.body.version).toBe(2)
      const other = await commit('session-b')
      expect(other.body.version).toBe(1)
    })

    it('retries once when the version collides', async () => {
      const pathname = await upload('session-a')
      const rival = await database().pool.connect()
      await rival.query('BEGIN')
      await rival.query(
        `INSERT INTO "PublishedBundle" (id, "userId", version, pathname, "blobUrl", sha256, "sizeBytes", manifest) VALUES ('rival', 'user-a', 1, 'bundles/user-a/rival.tar.gz', 'https://blob.test/rival', $1, 1, '{}')`,
        [SHA],
      )

      const committing = http()
        .post('/v1/published-bundles')
        .set(as('session-a'))
        .send({ pathname, sha256: SHA, manifest: MANIFEST })
        .then((response) => response)
      try {
        await waitForBlockedInsert(database().pool)
      } finally {
        await rival.query('COMMIT')
        rival.release()
      }
      const res = await committing

      expect(res.status).toBe(201)
      expect(res.body.version).toBe(2)
      expect((await bundlesOf()).map((bundle) => bundle.version)).toEqual([1, 2])
    })

    it('rejects a pathname outside the caller prefix', async () => {
      const foreign = await upload('session-b')

      await http()
        .post('/v1/published-bundles')
        .set(as('session-a'))
        .send({ pathname: foreign, sha256: SHA, manifest: MANIFEST })
        .expect(400)
      expect(await bundlesOf()).toHaveLength(0)
    })

    it('rejects a pathname with no uploaded blob', async () => {
      await http()
        .post('/v1/published-bundles')
        .set(as('session-a'))
        .send({ pathname: 'bundles/user-a/missing.tar.gz', sha256: SHA, manifest: MANIFEST })
        .expect(400)
    })

    it('rejects a pathname that is already committed', async () => {
      const first = await commit('session-a')
      expect(first.status).toBe(201)
      const pathname = (await bundlesOf())[0]?.pathname

      await http()
        .post('/v1/published-bundles')
        .set(as('session-a'))
        .send({ pathname, sha256: SHA, manifest: MANIFEST })
        .expect(409)
      expect(await bundlesOf()).toHaveLength(1)
    })

    it('rejects a bad manifest and a bad body', async () => {
      expect((await commit('session-a', { manifest: { skills: 'x' } })).status).toBe(400)
      expect((await commit('session-a', { manifest: {} })).status).toBe(400)
      expect((await commit('session-a', { sha256: 'xyz' })).status).toBe(400)
      expect((await commit('session-a', { manifest: undefined })).status).toBe(400)
      expect(await bundlesOf()).toHaveLength(0)
    })

    it('refuses a pod bearer', async () => {
      await http()
        .post('/v1/published-bundles')
        .set(as('pod-token-a'))
        .send({ pathname: 'bundles/user-a/x.tar.gz', sha256: SHA, manifest: MANIFEST })
        .expect(401)
    })
  })

  describe('GET /v1/published-bundles/current', () => {
    beforeEach(async () => {
      await commit('session-a')
      await commit('session-a')
    })

    it('serves the latest version with a download url to a session', async () => {
      const res = await http().get('/v1/published-bundles/current').set(as('session-a')).expect(200)

      expect(res.headers['cache-control']).toBe('no-store')
      expect(res.body).toMatchObject({
        version: 2,
        sha256: SHA,
        sizeBytes: 1234,
        manifest: MANIFEST,
      })
      expect(res.body.downloadUrl).toBe(
        `https://blob.test/get/${(await bundlesOf())[1]?.pathname}?sig=1`,
      )
    })

    it("serves the user's own pod", async () => {
      const res = await http()
        .get('/v1/published-bundles/current')
        .set(as('pod-token-a'))
        .expect(200)

      expect(res.body.version).toBe(2)
    })

    it("answers 404 to another user's pod and to a user with no bundle", async () => {
      await http().get('/v1/published-bundles/current').set(as('pod-token-c')).expect(404)
      await http().get('/v1/published-bundles/current').set(as('session-b')).expect(404)
    })

    it('requires a bearer', async () => {
      await http().get('/v1/published-bundles/current').expect(401)
    })
  })
})
