import { describe, expect, it } from 'bun:test'

import {
  dataUriBytesOf,
  PHOTO_STORE_LIMIT,
  photoOf,
  putPhoto,
  shareFileNameOf,
} from '../photo-store'
import { DISMISS_PULL, DOUBLE_TAP_SCALE, shouldDismiss, zoomRectOf } from '../photo-zoom'

const viewport = { width: 400, height: 800 }

describe('zoomRectOf', () => {
  it('zooms in around the tapped point', () => {
    const rect = zoomRectOf({ point: { x: 200, y: 400 }, viewport, zoomScale: 1 })
    const width = 400 / DOUBLE_TAP_SCALE
    const height = 800 / DOUBLE_TAP_SCALE
    expect(rect).toEqual({ x: 200 - width / 2, y: 400 - height / 2, width, height })
  })

  it('keeps the zoom rect inside the photo near an edge', () => {
    const rect = zoomRectOf({ point: { x: 2, y: 799 }, viewport, zoomScale: 1 })
    expect(rect.x).toBe(0)
    expect(rect.y + rect.height).toBe(800)
  })

  it('zooms back out to the whole photo when it is zoomed', () => {
    expect(zoomRectOf({ point: { x: 10, y: 10 }, viewport, zoomScale: 3 })).toEqual({
      x: 0,
      y: 0,
      ...viewport,
    })
  })
})

describe('shouldDismiss', () => {
  it('closes on a long pull down at full size', () => {
    expect(shouldDismiss({ pullY: -DISMISS_PULL, zoomScale: 1 })).toBe(true)
  })

  it('stays open on a short pull or while zoomed', () => {
    expect(shouldDismiss({ pullY: -DISMISS_PULL + 1, zoomScale: 1 })).toBe(false)
    expect(shouldDismiss({ pullY: -400, zoomScale: 2 })).toBe(false)
  })
})

describe('photo store', () => {
  it('hands back a photo by its id and forgets the oldest past the limit', () => {
    const first = putPhoto({ uri: 'https://x/a.png', name: 'a.png' })
    expect(photoOf(first)).toEqual({ uri: 'https://x/a.png', name: 'a.png' })
    for (let index = 0; index < PHOTO_STORE_LIMIT; index += 1)
      putPhoto({ uri: `https://x/${index}.png`, name: `${index}.png` })
    expect(photoOf(first)).toBeUndefined()
    expect(photoOf(undefined)).toBeUndefined()
  })

  it('names a shared file safely', () => {
    expect(shareFileNameOf({ name: 'my shot (1).png', at: 7 })).toBe('7-my_shot_1_.png')
    expect(shareFileNameOf({ name: '', at: 7 })).toBe('7-photo')
  })

  it('decodes the bytes of a base64 data uri', () => {
    expect(dataUriBytesOf('data:image/png;base64,AQID')).toEqual(new Uint8Array([1, 2, 3]))
    expect(dataUriBytesOf('https://x/a.png')).toBeUndefined()
  })
})
