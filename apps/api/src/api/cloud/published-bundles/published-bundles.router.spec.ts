import type { INestApplication } from '@nestjs/common'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { publishedBundleUploadSchema } from '@dltech/atlas-wire'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  bundlesOf,
  waitForBlockedInsert,
  withRivalBundle,
} from '../../../../test/fake-published-bundle-db'
import { buildSessionTrpcApp, dataOf, trpcMutation, trpcQuery } from '../session-trpc-test-app'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { BundleBlobStore } from './blob-store'
import { FakeBundleBlobStore } from './published-bundles.fakes'
import { PublishedBundlesRouter } from './published-bundles.router'
import { PublishedBundlesService } from './published-bundles.service'

const POD_TOKENS = {
  'pod-token-a': { threadId: 'thread-pod-a', userId: 'user-a' },
  'pod-token-c': { threadId: 'thread-pod-c', userId: 'user-c' },
}
const SHA = 'a'.repeat(64)
const MANIFEST = { skills: ['.agents/x'], instructions: ['ATLAS.md'], mcp: true }

const summaryOf = (body: unknown): { version?: unknown } => {
  const data = dataOf(body)
  return typeof data === 'object' && data !== null ? { version: Reflect.get(data, 'version') } : {}
}

describe('PublishedBundlesRouter', () => {
  const database = useTestDatabase()
  let app: INestApplication
  const blobs = new FakeBundleBlobStore()
  const issue = (token?: string) =>
    trpcMutation({ app, path: 'publishedBundles.issueUpload', token })
  const commitInput = (token: string | undefined, input: unknown) =>
    trpcMutation({ app, path: 'publishedBundles.commit', token, input })
  const current = (token?: string) => trpcQuery({ app, path: 'publishedBundles.current', token })

  const upload = async (token: string): Promise<string> => {
    const issued = await issue(token).expect(200)
    const { pathname } = publishedBundleUploadSchema.parse(dataOf(issued.body))
    blobs.uploaded.set(pathname, 1234)
    return pathname
  }
  const commit = async (token: string, overrides: Record<string, unknown> = {}) =>
    commitInput(token, {
      pathname: await upload(token),
      sha256: SHA,
      manifest: MANIFEST,
      ...overrides,
    })

  beforeEach(async () => {
    await seedSessionUsers()
    blobs.reset()
    app = await buildSessionTrpcApp({
      podTokens: POD_TOKENS,
      providers: [
        PublishedBundlesRouter,
        PublishedBundlesService,
        { provide: BundleBlobStore, useValue: blobs },
      ],
    })
  })

  afterEach(() => app.close())

  describe('publishedBundles.issueUpload', () => {
    it('issues a pathname under the caller prefix to a session', async () => {
      const res = await issue('session-a').expect(200)

      expect(res.headers['cache-control']).toBe('no-store')
      const grant = publishedBundleUploadSchema.parse(dataOf(res.body))
      expect(grant).toMatchObject({
        contentType: 'application/gzip',
        maximumSizeInBytes: 256 * 1024 * 1024,
      })
      expect(grant.pathname).toMatch(/^bundles\/user-a\/[0-9a-f-]+\.tar\.gz$/)
      expect(grant.uploadUrl).toBe(`https://blob.test/put/${grant.pathname}`)
    })

    it('refuses a pod bearer and an anonymous caller', async () => {
      await issue('pod-token-a').expect(401)
      await issue().expect(401)
      expect(blobs.presigned).toHaveLength(0)
    })
  })

  describe('publishedBundles.commit', () => {
    it('commits version 1 then version 2', async () => {
      const first = await commit('session-a')
      const second = await commit('session-a')

      expect(first.status).toBe(200)
      expect(first.headers['cache-control']).toBe('no-store')
      expect(dataOf(first.body)).toMatchObject({
        version: 1,
        sha256: SHA,
        sizeBytes: 1234,
        manifest: MANIFEST,
      })
      expect(second.status).toBe(200)
      expect(summaryOf(second.body).version).toBe(2)
      const other = await commit('session-b')
      expect(summaryOf(other.body).version).toBe(1)
    })

    it('retries once when the version collides', async () => {
      const pathname = await upload('session-a')

      const res = await withRivalBundle({
        pool: database().pool,
        sha: SHA,
        run: async (commitRival) => {
          const committing = commitInput('session-a', {
            pathname,
            sha256: SHA,
            manifest: MANIFEST,
          }).then((response) => response)
          await waitForBlockedInsert(database().pool)
          await commitRival()
          return committing
        },
      })

      expect(res.status).toBe(200)
      expect(summaryOf(res.body).version).toBe(2)
      expect((await bundlesOf()).map((bundle) => bundle.version)).toEqual([1, 2])
    })

    it('rejects a pathname outside the caller prefix', async () => {
      const foreign = await upload('session-b')

      await commitInput('session-a', { pathname: foreign, sha256: SHA, manifest: MANIFEST }).expect(
        400,
      )
      expect(await bundlesOf()).toHaveLength(0)
    })

    it('rejects a pathname with no uploaded blob', async () => {
      await commitInput('session-a', {
        pathname: 'bundles/user-a/missing.tar.gz',
        sha256: SHA,
        manifest: MANIFEST,
      }).expect(400)
    })

    it('rejects a pathname that is already committed', async () => {
      const first = await commit('session-a')
      expect(first.status).toBe(200)
      const pathname = (await bundlesOf())[0]?.pathname

      await commitInput('session-a', { pathname, sha256: SHA, manifest: MANIFEST }).expect(409)
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
      await commitInput('pod-token-a', {
        pathname: 'bundles/user-a/x.tar.gz',
        sha256: SHA,
        manifest: MANIFEST,
      }).expect(401)
    })
  })

  describe('publishedBundles.current', () => {
    beforeEach(async () => {
      await commit('session-a')
      await commit('session-a')
    })

    it('serves the latest version with a download url to a session', async () => {
      const res = await current('session-a').expect(200)

      expect(res.headers['cache-control']).toBe('no-store')
      expect(dataOf(res.body)).toMatchObject({
        version: 2,
        sha256: SHA,
        sizeBytes: 1234,
        manifest: MANIFEST,
        downloadUrl: `https://blob.test/get/${(await bundlesOf())[1]?.pathname}?sig=1`,
      })
    })

    it("serves the user's own pod", async () => {
      const res = await current('pod-token-a').expect(200)

      expect(summaryOf(res.body).version).toBe(2)
    })

    it("answers 404 to another user's pod and to a user with no bundle", async () => {
      await current('pod-token-c').expect(404)
      await current('session-b').expect(404)
    })

    it('requires a bearer', async () => {
      await current().expect(401)
    })
  })
})
