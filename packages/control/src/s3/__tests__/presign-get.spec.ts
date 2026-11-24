import { describe, expect, it } from 'bun:test'

import { contentDispositionOf, presignGetOverridesOf } from '../presign-get'

describe('contentDispositionOf', () => {
  it('names the download in both the ascii and the utf-8 parameter', () => {
    expect(contentDispositionOf('walkthrough.mp4')).toBe(
      `attachment; filename="walkthrough.mp4"; filename*=UTF-8''walkthrough.mp4`,
    )
  })

  it('percent-encodes a name that is not ascii in the utf-8 parameter', () => {
    expect(contentDispositionOf('récap final.mov')).toBe(
      `attachment; filename="r_cap final.mov"; filename*=UTF-8''r%C3%A9cap%20final.mov`,
    )
  })

  it('replaces quotes and backslashes so the quoted name cannot end early', () => {
    expect(contentDispositionOf('a"b\\c.txt')).toBe(
      `attachment; filename="a_b_c.txt"; filename*=UTF-8''a%22b%5Cc.txt`,
    )
  })

  it('replaces a carriage return so the header cannot be split', () => {
    expect(contentDispositionOf('a\rb.txt')).toContain('filename="a_b.txt"')
  })
})

describe('presignGetOverridesOf', () => {
  it('adds nothing when the caller names neither a type nor a name', () => {
    expect(presignGetOverridesOf({})).toEqual({})
  })

  it('sets the response content type for an inline read', () => {
    expect(presignGetOverridesOf({ contentType: 'video/mp4', downloadName: undefined })).toEqual({
      ResponseContentType: 'video/mp4',
    })
  })

  it('sets the response disposition for a download', () => {
    expect(presignGetOverridesOf({ downloadName: 'clip.webm' })).toEqual({
      ResponseContentDisposition: `attachment; filename="clip.webm"; filename*=UTF-8''clip.webm`,
    })
  })
})
