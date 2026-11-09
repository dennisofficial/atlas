import { describe, expect, it } from 'bun:test'

import type { Attachment } from '@dltech/atlas-core'

import { ECapability, EClientFrame, EServeFrame, type ClientFrame } from '../channel-wire'
import { harness } from './remote-channel-fixture'

const SHOT: Attachment = {
  id: '6f1c1d0e-8a58-4a5c-9d49-0d6c1d7f0a01',
  name: 'shot.png',
  mediaType: 'image/png',
  size: 3,
  content: {
    store: 'upload',
    uploadId: '6f1c1d0e-8a58-4a5c-9d49-0d6c1d7f0a01',
    pathname: 'composer-uploads/u/x/shot.png',
    inline: 'QUJD',
  },
  image: { width: 4, height: 2 },
}

const sendsOf = (sent: readonly ClientFrame[]) =>
  sent.filter((frame) => frame.kind === EClientFrame.Send)

const readied = (capabilities?: ECapability[]) => {
  const test = harness()
  test.open()
  test.receive({
    kind: EServeFrame.Ready,
    seq: 1,
    ...(capabilities === undefined ? {} : { capabilities }),
  })
  return test
}

describe('a send frame and the serve that reads it', () => {
  it('repeats the pictures in the legacy fields until the serve advertises attachments', () => {
    const test = readied()
    test.channel.send({ text: 'look', attachments: [SHOT] })

    expect(sendsOf(test.live().sent)[0]).toMatchObject({
      text: 'look',
      attachments: [SHOT],
      images: [{ path: 'shot.png', mediaType: 'image/png', data: 'QUJD', width: 4, height: 2 }],
      uploads: [
        {
          uploadId: SHOT.id,
          pathname: 'composer-uploads/u/x/shot.png',
          name: 'shot.png',
          size: 3,
          mediaType: 'image/png',
        },
      ],
    })
  })

  it('leaves the legacy fields off once the serve advertises attachments', () => {
    const test = readied([ECapability.Attachments])
    test.channel.send({ text: 'look', attachments: [SHOT] })

    const frame = sendsOf(test.live().sent)[0]
    expect(frame).toMatchObject({ text: 'look', attachments: [SHOT] })
    expect(frame).not.toHaveProperty('images')
    expect(frame).not.toHaveProperty('uploads')
  })

  it('adds nothing for a message without attachments', () => {
    const test = readied()
    test.channel.send({ text: 'look' })

    const frame = sendsOf(test.live().sent)[0]
    expect(frame).toMatchObject({ text: 'look' })
    expect(frame).not.toHaveProperty('images')
    expect(frame).not.toHaveProperty('uploads')
  })
})
