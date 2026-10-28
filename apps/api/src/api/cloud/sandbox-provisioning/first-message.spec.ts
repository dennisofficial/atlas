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
      images: [IMAGE],
    })
  })

  it('omits images when none or an empty list is given', () => {
    for (const images of [undefined, []]) {
      const body = JSON.parse(userSaidDraftOf({ sendId: 'snd-1', text: 'look', images }).body)
      expect(body).toEqual({ type: 'user-said', text: 'look', requestId: 'snd-1' })
      expect('images' in body).toBe(false)
    }
  })
})
