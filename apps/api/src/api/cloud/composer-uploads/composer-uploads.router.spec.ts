import type { INestApplication } from '@nestjs/common'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { composerUploadPresignReplySchema } from '@dltech/atlas-wire'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedThreadRow } from '../../../../test/session-seed'
import { buildSessionTrpcApp, dataOf, trpcMutation } from '../session-trpc-test-app'
import { seedSessionUsers } from '../web-settings.fake-db'
import { ComposerUploadBlobStore } from './composer-upload-blob-store'
import { FakeComposerUploadBlobStore } from './composer-uploads.fakes'
import { ComposerUploadsRouter } from './composer-uploads.router'
import { ComposerUploadsService } from './composer-uploads.service'

describe('ComposerUploadsRouter', () => {
  useTestDatabase()
  let app: INestApplication
  const blobs = new FakeComposerUploadBlobStore()
  const call = (path: string, token: string | undefined, input?: unknown) =>
    trpcMutation({ app, path: `composerUploads.${path}`, token, input })

  beforeEach(async () => {
    await seedSessionUsers()
    await seedThreadRow({ id: 'thread-a', userId: 'user-a' })
    await seedThreadRow({ id: 'thread-b', userId: 'user-b' })
    blobs.reset()
    app = await buildSessionTrpcApp({
      providers: [
        ComposerUploadsRouter,
        ComposerUploadsService,
        { provide: ComposerUploadBlobStore, useValue: blobs },
      ],
      sandboxTokens: { 'sandbox-a': { id: 'sbx-a', threadId: 'thread-a', userId: 'user-a' } },
      threadFamilies: { 'thread-a': ['thread-a'] },
    })
  })

  afterEach(() => app.close())

  describe('presign', () => {
    it('issues a user-prefixed pathname and a safe name', async () => {
      const res = await call('presign', 'session-a', {
        name: '../../etc/pass wd.txt',
        size: 12,
        mediaType: 'text/plain',
      }).expect(200)

      const reply = composerUploadPresignReplySchema.parse(dataOf(res.body))
      expect(reply.upload.name).toBe('pass wd.txt')
      expect(reply.upload.pathname).toBe(
        `composer-uploads/user-a/${reply.upload.uploadId}/pass wd.txt`,
      )
      expect(reply.upload).toMatchObject({ size: 12, mediaType: 'text/plain' })
      expect(blobs.presigned).toHaveLength(1)
    })

    it('rejects an oversize file and an anonymous caller', async () => {
      const input = {
        name: 'big.bin',
        size: 100 * 1024 * 1024 + 1,
        mediaType: '',
      }
      await call('presign', 'session-a', input).expect(400)
      await call('presign', undefined, { ...input, size: 1 }).expect(401)
      expect(blobs.presigned).toHaveLength(0)
    })
  })

  describe('discard', () => {
    it('deletes the caller own blob', async () => {
      await call('discard', 'session-a', {
        pathname: 'composer-uploads/user-a/x/f.txt',
      }).expect(200)
      expect(blobs.deleted).toEqual(['composer-uploads/user-a/x/f.txt'])
    })

    it('refuses another user pathname', async () => {
      await call('discard', 'session-a', {
        pathname: 'composer-uploads/user-b/x/f.txt',
      }).expect(400)
      expect(blobs.deleted).toEqual([])
    })
  })

  describe('download', () => {
    const pathname = 'composer-uploads/user-a/x/f.txt'

    it('returns a signed url for an owned thread', async () => {
      blobs.uploaded.set(pathname, { size: 7, uploadedAt: new Date() })
      const res = await call('download', 'session-a', {
        threadId: 'thread-a',
        pathname,
      }).expect(200)
      expect(dataOf(res.body)).toEqual({
        found: true,
        downloadUrl: `https://blob.test/get/${pathname}?sig=1`,
        size: 7,
      })
    })

    it('answers found:false for a missing blob', async () => {
      const res = await call('download', 'session-a', {
        threadId: 'thread-a',
        pathname,
      }).expect(200)
      expect(dataOf(res.body)).toEqual({ found: false })
    })

    it('refuses a thread the user does not own', async () => {
      await call('download', 'session-a', {
        threadId: 'thread-b',
        pathname,
      }).expect(404)
    })

    it('refuses another user pathname on an owned thread', async () => {
      await call('download', 'session-a', {
        threadId: 'thread-a',
        pathname: 'composer-uploads/user-b/x/f.txt',
      }).expect(400)
    })
  })

  describe('download with a sandbox token', () => {
    it('reaches its own thread', async () => {
      blobs.uploaded.set('composer-uploads/user-a/u1/a.txt', { size: 3, uploadedAt: new Date() })
      const res = await call('download', 'sandbox-a', {
        threadId: 'thread-a',
        pathname: 'composer-uploads/user-a/u1/a.txt',
      })
      expect(res.status).toBe(200)
    })

    it('is refused a thread outside its family', async () => {
      const res = await call('download', 'sandbox-a', {
        threadId: 'thread-b',
        pathname: 'composer-uploads/user-b/u1/b.txt',
      })
      expect(res.status).toBe(403)
    })
  })
})
