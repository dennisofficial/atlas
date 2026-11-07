import { describe, expect, it } from 'bun:test'

import { MAX_MESSAGE_UPLOADS } from '@dltech/atlas-core'

import { isModelImage, routeAttachments } from '../session-attachments'

const fileOf = (args: { name: string; type: string }) =>
  new File(['x'], args.name, { type: args.type })

describe('isModelImage', () => {
  it('accepts the formats the model reads', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      expect(isModelImage({ type })).toBe(true)
    }
  })

  it('refuses svg, heic and non-images', () => {
    for (const type of ['image/svg+xml', 'image/heic', 'application/x-sh', '']) {
      expect(isModelImage({ type })).toBe(false)
    }
  })
})

describe('routeAttachments', () => {
  it('sends png to images and everything else to others', () => {
    const png = fileOf({ name: 'a.png', type: 'image/png' })
    const svg = fileOf({ name: 'b.svg', type: 'image/svg+xml' })
    const script = fileOf({ name: 'deploy.sh', type: '' })

    const routed = routeAttachments({ files: [png, svg, script], held: 0 })

    expect(routed.images).toEqual([png])
    expect(routed.others).toEqual([svg, script])
    expect(routed.droppedOverflow).toBe(false)
  })

  it('shares one limit across images and files already held', () => {
    const png = fileOf({ name: 'a.png', type: 'image/png' })
    const script = fileOf({ name: 'deploy.sh', type: '' })

    const routed = routeAttachments({ files: [png, script], held: MAX_MESSAGE_UPLOADS - 1 })

    expect(routed.images).toEqual([png])
    expect(routed.others).toEqual([])
    expect(routed.droppedOverflow).toBe(true)
  })

  it('drops everything when the message is full', () => {
    const routed = routeAttachments({
      files: [fileOf({ name: 'a.png', type: 'image/png' })],
      held: MAX_MESSAGE_UPLOADS,
    })

    expect(routed).toEqual({ images: [], others: [], droppedOverflow: true })
  })
})
