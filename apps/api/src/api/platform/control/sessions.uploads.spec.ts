import { describe, expect, it } from 'bun:test'
import { BadRequestException } from '@nestjs/common'
import type { SaidUpload } from '@dltech/atlas-core'
import { setupSessionsService as setup } from './sessions.service.fixture'

const UPLOAD_ID = '11111111-1111-4111-8111-111111111111'

const uploadOf = (args: { userId: string; claimedSize?: number }): SaidUpload => ({
  uploadId: UPLOAD_ID,
  pathname: `composer-uploads/${args.userId}/${UPLOAD_ID}/notes.txt`,
  name: 'notes.txt',
  size: args.claimedSize ?? 999,
  mediaType: 'text/plain',
})

const setupSession = async () => {
  const ctx = setup()
  const { sessionId } = await ctx.service.create({ userId: 'user-a', projectId: 'proj-a' })
  return { ...ctx, sessionId }
}

describe('SessionsService.post uploads', () => {
  it('refuses an upload that belongs to another user', async () => {
    const { service, mediaStore, sessionId } = await setupSession()
    const foreign = uploadOf({ userId: 'user-b' })
    mediaStore.put({ pathname: foreign.pathname, bytes: new Uint8Array(7) })
    await expect(
      service.post({ userId: 'user-a', sessionId, text: 'hi', uploads: [foreign] }),
    ).rejects.toThrow(new BadRequestException('file notes.txt does not belong to this account'))
  })

  it('refuses a pathname that does not match the upload id and name', async () => {
    const { service, mediaStore, sessionId } = await setupSession()
    const forged = {
      ...uploadOf({ userId: 'user-a' }),
      pathname: 'composer-uploads/user-a/22222222-2222-4222-8222-222222222222/notes.txt',
    }
    mediaStore.put({ pathname: forged.pathname, bytes: new Uint8Array(7) })
    await expect(
      service.post({ userId: 'user-a', sessionId, text: 'hi', uploads: [forged] }),
    ).rejects.toThrow('does not belong to this account')
  })

  it('refuses an upload whose blob is missing', async () => {
    const { service, sessionId } = await setupSession()
    await expect(
      service.post({
        userId: 'user-a',
        sessionId,
        text: 'hi',
        uploads: [uploadOf({ userId: 'user-a' })],
      }),
    ).rejects.toThrow(new BadRequestException('file notes.txt was not uploaded'))
  })

  it('stores the stored size, not the claimed one', async () => {
    const { service, plane, mediaStore, sessionId } = await setupSession()
    const upload = uploadOf({ userId: 'user-a', claimedSize: 999 })
    mediaStore.put({ pathname: upload.pathname, bytes: new Uint8Array(7) })
    await service.post({ userId: 'user-a', sessionId, text: 'see file', uploads: [upload] })
    const inbox = await plane.readInbox({ sessionId, afterId: 0, limit: 10 })
    expect(JSON.parse(inbox[0]?.payload ?? '')).toEqual({
      text: 'see file',
      attachments: [
        {
          id: upload.uploadId,
          name: 'notes.txt',
          mediaType: 'text/plain',
          size: 7,
          content: {
            store: 'upload',
            uploadId: upload.uploadId,
            pathname: upload.pathname,
          },
        },
      ],
    })
  })

  it('accepts a post with an upload and no text', async () => {
    const { service, mediaStore, sessionId } = await setupSession()
    const upload = uploadOf({ userId: 'user-a' })
    mediaStore.put({ pathname: upload.pathname, bytes: new Uint8Array(7) })
    const posted = await service.post({ userId: 'user-a', sessionId, text: '', uploads: [upload] })
    expect(posted.inboxId).toBe(1)
  })

  it('folds a legacy picture and its upload into one attachment, once', async () => {
    const { service, plane, mediaStore, sessionId } = await setupSession()
    const upload = {
      ...uploadOf({ userId: 'user-a' }),
      name: 'shot.png',
      mediaType: 'image/png',
    }
    const pathname = `composer-uploads/user-a/${UPLOAD_ID}/shot.png`
    mediaStore.put({ pathname, bytes: new Uint8Array(7) })
    await service.post({
      userId: 'user-a',
      sessionId,
      text: 'look',
      uploads: [{ ...upload, pathname }],
    })
    const inbox = await plane.readInbox({ sessionId, afterId: 0, limit: 10 })
    const payload = JSON.parse(inbox[0]?.payload ?? '')
    expect(payload.attachments).toHaveLength(1)
    expect('uploads' in payload).toBe(false)
    expect('images' in payload).toBe(false)
  })

  it('refuses an unowned upload sent as an attachment', async () => {
    const { service, mediaStore, sessionId } = await setupSession()
    const foreign = uploadOf({ userId: 'user-b' })
    mediaStore.put({ pathname: foreign.pathname, bytes: new Uint8Array(7) })
    await expect(
      service.post({
        userId: 'user-a',
        sessionId,
        text: 'hi',
        attachments: [
          {
            id: foreign.uploadId,
            name: foreign.name,
            mediaType: foreign.mediaType,
            size: 7,
            content: {
              store: 'upload',
              uploadId: foreign.uploadId,
              pathname: foreign.pathname,
            },
          },
        ],
      }),
    ).rejects.toThrow(new BadRequestException('file notes.txt does not belong to this account'))
  })
})
