import { describe, expect, it } from 'bun:test'
import { userSaidDraftOf } from './first-message'

const IMAGE = { path: 'shot.png', mediaType: 'image/png', data: 'aGk=', width: 4, height: 3 }

describe('userSaidDraftOf', () => {
  it('writes the images into the user-said body', () => {
    const draft = userSaidDraftOf({ sendId: 'snd-1', text: 'look', images: [IMAGE] })

    expect(draft.type).toBe('user-said')
    expect(JSON.parse(draft.body)).toEqual({
      type: 'user-said',
      text: 'look',
      requestId: 'snd-1',
      attachments: [
        {
          id: 'image:0',
          name: 'shot.png',
          mediaType: 'image/png',
          size: 3,
          source: 'shot.png',
          content: { store: 'inline', data: 'aGk=' },
          image: { width: 4, height: 3 },
        },
      ],
    })
  })

  it('omits images when none or an empty list is given', () => {
    for (const images of [undefined, []]) {
      const body = JSON.parse(userSaidDraftOf({ sendId: 'snd-1', text: 'look', images }).body)
      expect(body).toEqual({ type: 'user-said', text: 'look', requestId: 'snd-1' })
      expect('images' in body).toBe(false)
    }
  })

  it('writes uploads into the body and omits an empty list', () => {
    const upload = {
      uploadId: 'u1',
      pathname: 'composer-uploads/x/u1/a.txt',
      name: 'a.txt',
      size: 1,
      mediaType: 'text/plain',
    }
    const body = JSON.parse(userSaidDraftOf({ sendId: 's', text: 'look', uploads: [upload] }).body)
    expect(body.attachments).toHaveLength(1)
    expect(body.attachments[0].content.store).toBe('upload')
    expect('uploads' in body).toBe(false)
    const empty = JSON.parse(userSaidDraftOf({ sendId: 's', text: 'look', uploads: [] }).body)
    expect('attachments' in empty).toBe(false)
  })
})
