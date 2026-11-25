import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { TranscriptToolPicture, toolPictureBox } from '../transcript-tool-picture'

const boxOf = (html: string): { width: string; height: string } => {
  const match = /width:(\d+)px;height:(\d+)px/.exec(html)
  if (match === null) throw new Error(`no box in ${html}`)
  return { width: `${match[1]}px`, height: `${match[2]}px` }
}

const PICTURE = {
  kind: 'media',
  media: { hash: 'a'.repeat(64), mediaType: 'image/png', size: 4, width: 8, height: 6 },
} as const

describe('TranscriptToolPicture', () => {
  it('reserves the box of a picture until its bytes arrive', () => {
    const html = renderToStaticMarkup(
      <TranscriptToolPicture id="call-1#image" alt="shot.png" picture={PICTURE} />,
    )

    expect(html).not.toContain('<img')
    expect(boxOf(html)).toEqual({ width: '8px', height: '6px' })
  })

  it('caps a tall picture at the height limit and never upscales a small one', () => {
    expect(toolPictureBox({ width: 400, height: 1_000 })).toEqual({ width: 128, height: 320 })
    expect(toolPictureBox({ width: 200, height: 100 })).toEqual({ width: 200, height: 100 })
    expect(toolPictureBox({})).toEqual({ width: 256, height: 192 })
  })
})
