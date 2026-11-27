import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

mock.module('../../data/media-urls', () => ({
  mediaUrls: { urlOf: async () => 'https://media.test/shot.png' },
}))

const { TranscriptToolPicture } = await import('../transcript-tool-picture')
const { ToolPictureSessionProvider } = await import('../tool-picture-session')

const HASH = 'a'.repeat(64)

const pictureOf = () =>
  ({
    kind: 'media',
    media: { hash: HASH, mediaType: 'image/png', size: 4, width: 8, height: 6 },
  }) as const

const viewOf = (picture: ReturnType<typeof pictureOf>) => (
  <ToolPictureSessionProvider value="ses_1">
    <TranscriptToolPicture id="call-1#image" alt="shot.png" picture={picture} />
  </ToolPictureSessionProvider>
)

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

describe('an opened transcript picture', () => {
  it('stays open when a live update rebuilds the same picture', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => root.render(viewOf(pictureOf())))

    const trigger = host.querySelector('button[aria-label="Open shot.png"]')
    if (!(trigger instanceof HTMLElement)) throw new Error('no picture trigger')
    await act(async () => trigger.click())
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()

    await act(async () => root.render(viewOf(pictureOf())))

    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => root.unmount())
    host.remove()
  })
})
