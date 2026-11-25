import { db } from '@dltech/atlas-db'
import type { INestApplication } from '@nestjs/common'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { composerUploadPresignReplySchema } from '@dltech/atlas-wire'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { buildSessionTrpcApp, dataOf, trpcMutation } from '../session-trpc-test-app'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
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
    blobs.reset()
    app = await buildSessionTrpcApp({
      providers: [
        ComposerUploadsRouter,
        ComposerUploadsService,
        { provide: ComposerUploadBlobStore, useValue: blobs },
      ],
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
    const PATHNAME = 'composer-uploads/user-a/x/f.txt'

    const seedDraft = async (args: { userId: string; pathname: string }) =>
      db.orm.public.SessionDraft.create({
        userId: args.userId,
        scopeKey: 'new',
        text: 'see the file',
        attachments: JSON.stringify([{ pathname: args.pathname }]),
        updatedAt: new Date(),
      })

    it('keeps a blob a composer draft references', async () => {
      await seedDraft({ userId: 'user-a', pathname: PATHNAME })
      await call('discard', 'session-a', { pathname: PATHNAME }).expect(200)
      expect(blobs.deleted).toEqual([])
    })

    it('deletes a blob only another user draft mentions', async () => {
      await seedDraft({ userId: 'user-b', pathname: PATHNAME })
      await call('discard', 'session-a', { pathname: PATHNAME }).expect(200)
      expect(blobs.deleted).toEqual([PATHNAME])
    })

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

    it('refuses another user pathname on an owned thread', async () => {
      await call('download', 'session-a', {
        threadId: 'thread-a',
        pathname: 'composer-uploads/user-b/x/f.txt',
      }).expect(400)
    })
  })
})
