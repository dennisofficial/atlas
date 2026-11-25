import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  TOOL_PICTURE_MAX_HEIGHT,
  TranscriptToolPicture,
  toolPictureBox,
} from '../transcript-tool-picture'

const boxOf = (html: string): { width: string; height: string } => {
  const match = /width:(\d+)px;height:(\d+)px/.exec(html)
  if (match === null) throw new Error(`no box in ${html}`)
  return { width: `${match[1]}px`, height: `${match[2]}px` }
}

describe('TranscriptToolPicture', () => {
  it('draws an inline picture straight from its bytes', () => {
    const html = renderToStaticMarkup(
      <TranscriptToolPicture
        id="call-1#image"
        alt="shot.png"
        picture={{ kind: 'inline', data: 'iVBOR', mediaType: 'image/png' }}
      />,
    )

    expect(html).toContain('src="data:image/png;base64,iVBOR"')
  })

  it('reserves the box of a withheld picture until its bytes arrive', () => {
    const html = renderToStaticMarkup(
      <TranscriptToolPicture
        id="call-1#image"
        alt="shot.png"
        picture={{
          kind: 'withheld',
          threadId: 'thread-1',
          seq: 2,
          part: 1,
          mediaType: 'image/png',
          width: 8,
          height: 6,
        }}
      />,
    )

    expect(html).not.toContain('<img')
    expect(boxOf(html)).toEqual({ width: '8px', height: '6px' })
  })

  it('keeps one box across the loading and loaded states of the same picture', () => {
    const size = { width: 640, height: 400 }
    const loading = renderToStaticMarkup(
      <TranscriptToolPicture
        id="call-1#image"
        alt="shot.png"
        picture={{ kind: 'inline', data: 'iVBOR', mediaType: 'image/png' }}
        {...size}
      />,
    )
    const pending = renderToStaticMarkup(
      <TranscriptToolPicture
        id="call-1#image"
        alt="shot.png"
        picture={{
          kind: 'withheld',
          threadId: 'thread-1',
          seq: 2,
          part: 1,
          mediaType: 'image/png',
          ...size,
        }}
      />,
    )

    expect(loading).toContain('<img')
    expect(pending).not.toContain('<img')
    expect(boxOf(loading)).toEqual({ width: '512px', height: `${TOOL_PICTURE_MAX_HEIGHT}px` })
    expect(boxOf(pending)).toEqual(boxOf(loading))
  })

  it('caps a tall picture at the height limit and never upscales a small one', () => {
    expect(toolPictureBox({ width: 400, height: 1_000 })).toEqual({ width: 128, height: 320 })
    expect(toolPictureBox({ width: 200, height: 100 })).toEqual({ width: 200, height: 100 })
    expect(toolPictureBox({})).toEqual({ width: 256, height: 192 })
  })
})
