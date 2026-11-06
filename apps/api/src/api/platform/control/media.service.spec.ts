import { describe, expect, it } from 'bun:test'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { MAX_INLINE_BYTES } from '@dltech/atlas-core'
import { pngBytes, setupMedia } from './media.fixture'

const HASH = 'f'.repeat(64)

describe('MediaService', () => {
  describe('presign', () => {
    it('signs an upload to the user-scoped pathname when the image is new', async () => {
      const { service } = setupMedia()
      const out = await service.presign({
        userId: 'user-a',
        hash: HASH,
        size: 10,
        mediaType: 'image/png',
      })
      if (out.exists) throw new Error('expected a new upload')
      expect(out.uploadUrl).toContain(`media/user-a/${HASH}`)
      expect(out.uploadUrl).toContain(`max=${MAX_INLINE_BYTES}`)
      expect(out.validUntil).toBeGreaterThan(Date.now())
    })

    it('answers exists with the recorded ref and signs nothing', async () => {
      const { service, store, upload } = setupMedia()
      const { hash } = upload({
        userId: 'user-a',
        bytes: pngBytes({ width: 3, height: 2 }),
      })
      await service.confirm({ userId: 'user-a', hash })
      const out = await service.presign({
        userId: 'user-a',
        hash,
        size: 10,
        mediaType: 'image/png',
      })
      expect(out).toEqual({
        exists: true,
        media: {
          hash,
          mediaType: 'image/png',
          size: expect.any(Number),
          width: 3,
          height: 2,
        },
      })
      expect(store.issued).toBe(0)
    })

    it('does not share a row between users', async () => {
      const { service, upload } = setupMedia()
      const { hash } = upload({
        userId: 'user-a',
        bytes: pngBytes({ width: 3, height: 2 }),
      })
      await service.confirm({ userId: 'user-a', hash })
      const out = await service.presign({
        userId: 'user-b',
        hash,
        size: 10,
        mediaType: 'image/png',
      })
      expect(out.exists).toBe(false)
    })
  })

  describe('confirm', () => {
    it('records a valid image and returns its ref', async () => {
      const { service, registry, upload } = setupMedia()
      const bytes = pngBytes({ width: 4, height: 5 })
      const { hash } = upload({ userId: 'user-a', bytes })
      const out = await service.confirm({ userId: 'user-a', hash })
      expect(out.media).toEqual({
        hash,
        mediaType: 'image/png',
        size: bytes.byteLength,
        width: 4,
        height: 5,
      })
      expect(registry.rows.get(`user-a/${hash}`)).toEqual(out.media)
    })

    it('is idempotent once recorded', async () => {
      const { service, store, upload } = setupMedia()
      const { hash, pathname } = upload({
        userId: 'user-a',
        bytes: pngBytes({ width: 1, height: 1 }),
      })
      const first = await service.confirm({ userId: 'user-a', hash })
      store.blobs.delete(pathname)
      store.contents.delete(pathname)
      expect(await service.confirm({ userId: 'user-a', hash })).toEqual(first)
    })

    it('deletes the blob and refuses bytes that do not match the hash', async () => {
      const { service, store, upload } = setupMedia()
      const { pathname } = upload({
        userId: 'user-a',
        bytes: pngBytes({ width: 2, height: 2 }),
        hash: HASH,
      })
      await expect(service.confirm({ userId: 'user-a', hash: HASH })).rejects.toThrow(
        new BadRequestException('the uploaded bytes do not match the hash'),
      )
      expect(store.deleted).toEqual([pathname])
      expect(await store.head({ pathname })).toBeNull()
    })

    it('deletes the blob and refuses bytes that are not an image', async () => {
      const { service, store, registry, upload } = setupMedia()
      const { hash, pathname } = upload({
        userId: 'user-a',
        bytes: new TextEncoder().encode('<svg onload=alert(1)>'),
      })
      await expect(service.confirm({ userId: 'user-a', hash })).rejects.toThrow(
        'not a supported image',
      )
      expect(store.deleted).toEqual([pathname])
      expect(registry.rows.size).toBe(0)
    })

    it('deletes the blob and refuses an image past the inline limit', async () => {
      const { service, store, upload } = setupMedia()
      const big = new Uint8Array(MAX_INLINE_BYTES + 1)
      big.set(pngBytes({ width: 2, height: 2 }))
      const { hash, pathname } = upload({ userId: 'user-a', bytes: big })
      await expect(service.confirm({ userId: 'user-a', hash })).rejects.toBeInstanceOf(
        BadRequestException,
      )
      expect(store.deleted).toEqual([pathname])
    })

    it('answers not found when nothing was uploaded', async () => {
      const { service } = setupMedia()
      await expect(service.confirm({ userId: 'user-a', hash: HASH })).rejects.toBeInstanceOf(
        NotFoundException,
      )
    })
  })

  describe('url', () => {
    const uploaded = async () => {
      const ctx = setupMedia()
      const { hash } = ctx.upload({
        userId: 'user-a',
        bytes: pngBytes({ width: 2, height: 2 }),
      })
      await ctx.service.confirm({ userId: 'user-a', hash })
      const { sessionId } = await ctx.sessionsService.create({
        userId: 'user-a',
        projectId: 'proj-a',
      })
      return { ...ctx, hash, sessionId }
    }

    it('signs a one hour read url for the owner of a recorded image', async () => {
      const { service, hash, sessionId } = await uploaded()
      const out = await service.url({ userId: 'user-a', sessionId, hash })
      expect(out.url).toContain(`media/user-a/${hash}`)
      expect(out.url).toMatch(/validUntil=\d+/)
      const validUntil = Number(/validUntil=(\d+)/.exec(out.url)?.[1])
      expect(validUntil - Date.now()).toBeGreaterThan(59 * 60 * 1000)
    })

    it('refuses a session that belongs to someone else', async () => {
      const { service, hash, sessionId } = await uploaded()
      await expect(service.url({ userId: 'user-b', sessionId, hash })).rejects.toBeInstanceOf(
        NotFoundException,
      )
    })

    it('refuses an image the user never recorded', async () => {
      const { service, sessionId } = await uploaded()
      await expect(service.url({ userId: 'user-a', sessionId, hash: HASH })).rejects.toBeInstanceOf(
        NotFoundException,
      )
    })
  })

  describe('posting a message with images', () => {
    it('refuses an image that was never uploaded', async () => {
      const { sessionsService } = setupMedia()
      const { sessionId } = await sessionsService.create({
        userId: 'user-a',
        projectId: 'proj-a',
      })
      await expect(
        sessionsService.post({
          userId: 'user-a',
          sessionId,
          text: 'x',
          media: [{ hash: HASH }],
        }),
      ).rejects.toThrow(new BadRequestException(`image ${HASH} was not uploaded`))
    })

    it("refuses another user's image", async () => {
      const { sessionsService, service, upload } = setupMedia()
      const { hash } = upload({
        userId: 'user-b',
        bytes: pngBytes({ width: 2, height: 2 }),
      })
      await service.confirm({ userId: 'user-b', hash })
      const { sessionId } = await sessionsService.create({
        userId: 'user-a',
        projectId: 'proj-a',
      })
      await expect(
        sessionsService.post({
          userId: 'user-a',
          sessionId,
          text: '',
          media: [{ hash }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('carries the recorded ref and source in the inbox payload', async () => {
      const { sessionsService, service, plane, upload } = setupMedia()
      const { hash } = upload({
        userId: 'user-a',
        bytes: pngBytes({ width: 2, height: 3 }),
      })
      const { media } = await service.confirm({ userId: 'user-a', hash })
      const { sessionId } = await sessionsService.create({
        userId: 'user-a',
        projectId: 'proj-a',
      })
      await sessionsService.post({
        userId: 'user-a',
        sessionId,
        text: '',
        media: [{ hash, source: 'shot.png' }, { hash }],
      })
      const [entry] = await plane.readInbox({
        sessionId,
        afterId: 0,
        limit: 10,
      })
      expect(JSON.parse(entry?.payload ?? '')).toEqual({
        text: '',
        media: [{ media, source: 'shot.png' }, { media }],
      })
    })

    it('omits media from a text-only payload', async () => {
      const { sessionsService, plane } = setupMedia()
      const { sessionId } = await sessionsService.create({
        userId: 'user-a',
        projectId: 'proj-a',
      })
      await sessionsService.post({ userId: 'user-a', sessionId, text: 'hi' })
      const [entry] = await plane.readInbox({
        sessionId,
        afterId: 0,
        limit: 10,
      })
      expect(JSON.parse(entry?.payload ?? '')).toEqual({ text: 'hi' })
    })
  })
})
