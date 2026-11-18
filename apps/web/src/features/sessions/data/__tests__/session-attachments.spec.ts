import { describe, expect, it } from 'bun:test'

import { MAX_MESSAGE_UPLOADS } from '@dltech/atlas-core'

import { routeAttachments } from '../session-attachments'

const fileOf = (args: { name: string; type: string }) =>
  new File(['x'], args.name, { type: args.type })

describe('routeAttachments', () => {
  it('sends every image to the media path, heic and svg included', () => {
    const png = fileOf({ name: 'a.png', type: 'image/png' })
    const heic = fileOf({ name: 'IMG_0042.HEIC', type: 'image/heic' })
    const svg = fileOf({ name: 'logo.svg', type: 'image/svg+xml' })
    const script = fileOf({ name: 'deploy.sh', type: '' })

    const routed = routeAttachments({ files: [png, heic, svg, script], held: 0 })

    expect(routed.images).toEqual([png, heic, svg])
    expect(routed.others).toEqual([script])
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
