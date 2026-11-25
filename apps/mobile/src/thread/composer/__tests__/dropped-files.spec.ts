import { describe, expect, it } from 'bun:test'

import { droppedFilesOf } from '../dropped-files'

describe('droppedFilesOf', () => {
  it('keeps the name, type and uri of a dropped screenshot and leaves the size to be read', () => {
    expect(
      droppedFilesOf({
        assets: [{ uri: 'file:///tmp/A.png', type: 'image/png', fileName: 'A.png' }],
        at: 5,
      }),
    ).toEqual([{ name: 'A.png', size: 0, mediaType: 'image/png', uri: 'file:///tmp/A.png' }])
  })

  it('names a dropped file that has no name from its type', () => {
    const [file] = droppedFilesOf({
      assets: [{ uri: 'blob:x', type: 'image/jpeg' }],
      at: 5,
    })
    expect(file?.name).toBe('dropped-5-1.jpg')
  })

  it('ignores dropped text, which has no file', () => {
    expect(droppedFilesOf({ assets: [{ type: 'text/plain', text: 'hi' }], at: 1 })).toEqual([])
  })

  it('treats a dropped file without a type as bytes', () => {
    const [file] = droppedFilesOf({ assets: [{ uri: 'file:///tmp/x', type: '' }], at: 2 })
    expect(file?.mediaType).toBe('application/octet-stream')
  })
})
