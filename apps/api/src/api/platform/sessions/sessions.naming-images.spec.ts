import { describe, expect, it } from 'bun:test'
import { mediaPathname } from '@dltech/atlas-core'
import type { FakeMediaStore } from '@dltech/atlas-media/testing'
import { pngBytes } from './media.fixture'
import type { FakeMediaRegistry } from './media-registry.fake'
import { sha256Hex } from './media-validation'
import { listedSession, setupNaming } from './sessions.naming.fixture'

const uploadImage = async (args: { registry: FakeMediaRegistry; mediaStore: FakeMediaStore }) => {
  const bytes = pngBytes({ width: 4, height: 3 })
  const hash = sha256Hex(bytes)
  await args.registry.insertIfAbsent({
    userId: 'user-a',
    media: { hash, mediaType: 'image/png', size: bytes.byteLength, width: 4, height: 3 },
  })
  args.mediaStore.put({ pathname: mediaPathname({ userId: 'user-a', hash }), bytes })
  return { hash, data: Buffer.from(bytes).toString('base64') }
}

describe('SessionsService naming with images', () => {
  it('names an image-only post from the image', async () => {
    const { service, titler, background, registry, mediaStore } = setupNaming()
    titler.next = async () => 'Broken Layout'
    const image = await uploadImage({ registry, mediaStore })
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    await service.post({
      userId: 'user-a',
      sessionId: created.sessionId,
      text: '',
      media: [{ hash: image.hash, source: 'shot.png' }],
    })
    await background.settle()

    expect((await listedSession({ service, sessionId: created.sessionId }))?.title).toBe(
      'Broken Layout',
    )
    expect(titler.calls).toMatchObject([
      {
        userId: 'user-a',
        projectId: 'proj-a',
        text: '',
        images: [
          { path: 'shot.png', mediaType: 'image/png', data: image.data, width: 4, height: 3 },
        ],
      },
    ])
  })

  it('hands attached images to the titler alongside the text', async () => {
    const { service, titler, background, registry, mediaStore } = setupNaming()
    titler.next = async () => 'Header Spacing'
    const image = await uploadImage({ registry, mediaStore })
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    await service.post({
      userId: 'user-a',
      sessionId: created.sessionId,
      text: 'fix this',
      media: [{ hash: image.hash }],
    })
    await background.settle()

    expect(titler.calls[0]?.text).toBe('fix this')
    expect(titler.calls[0]?.images?.map((said) => said.data)).toEqual([image.data])
  })

  it('names from the text alone when an image cannot be read back', async () => {
    const { service, titler, background, registry, mediaStore } = setupNaming()
    titler.next = async () => 'Header Spacing'
    const image = await uploadImage({ registry, mediaStore })
    mediaStore.contents.clear()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    await service.post({
      userId: 'user-a',
      sessionId: created.sessionId,
      text: 'fix this',
      media: [{ hash: image.hash }],
    })
    await background.settle()

    expect(titler.calls).toMatchObject([
      { userId: 'user-a', projectId: 'proj-a', text: 'fix this' },
    ])
  })

  it('leaves an image-only session untitled when the titler answers nothing', async () => {
    const { service, background, registry, mediaStore } = setupNaming()
    const image = await uploadImage({ registry, mediaStore })
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    await service.post({
      userId: 'user-a',
      sessionId: created.sessionId,
      text: '',
      media: [{ hash: image.hash }],
    })
    await background.settle()

    expect((await listedSession({ service, sessionId: created.sessionId }))?.title).toBeNull()
  })
})
