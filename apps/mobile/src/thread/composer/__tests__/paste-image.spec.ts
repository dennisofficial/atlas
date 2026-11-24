import { describe, expect, it } from 'bun:test'

import { pastedImageOf, pickedOfPasted } from '../paste-image'

describe('pastedImageOf', () => {
  it('reads the media type, the bytes and a name from a pasted png', () => {
    expect(pastedImageOf({ data: 'data:image/png;base64,iVBORw0KGgo=', at: 7 })).toEqual({
      name: 'pasted-7.png',
      mediaType: 'image/png',
      base64: 'iVBORw0KGgo=',
      size: 8,
    })
  })

  it('names a pasted jpeg with the jpg extension', () => {
    expect(pastedImageOf({ data: 'data:image/jpeg;base64,/9j/4AAQ', at: 1 })?.name).toBe(
      'pasted-1.jpg',
    )
  })

  it('refuses data that is not an image data uri', () => {
    expect(pastedImageOf({ data: 'hello', at: 1 })).toBeNull()
    expect(pastedImageOf({ data: 'data:text/plain;base64,aGk=', at: 1 })).toBeNull()
    expect(pastedImageOf({ data: 'data:image/png;base64,', at: 1 })).toBeNull()
  })
})

describe('pickedOfPasted', () => {
  it('turns a pasted image into a picked file at its written uri', () => {
    const image = { name: 'pasted-1.png', mediaType: 'image/png', base64: 'AAAA', size: 3 }
    expect(pickedOfPasted({ image, uri: 'file:///cache/pasted-1.png' })).toEqual({
      name: 'pasted-1.png',
      size: 3,
      mediaType: 'image/png',
      uri: 'file:///cache/pasted-1.png',
    })
  })
})
