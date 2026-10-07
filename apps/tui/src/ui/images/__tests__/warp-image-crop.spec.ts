import { afterEach, describe, expect, test } from 'bun:test'
import { BoxRenderable, ScrollBoxRenderable, type NativeImage } from '@opentui/core'

import { TranscriptImageRenderable } from '../transcript-image'
import { ViewerImageRenderable } from '../viewer-image'
import {
  bandedImage,
  bandsOf,
  draw,
  restoreTermProgram,
  translate,
  withPicture,
  type Kind,
} from './warp-image-harness'

afterEach(restoreTermProgram)

const kinds: Array<[string, Kind]> = [
  ['transcript picture', TranscriptImageRenderable],
  ['viewer picture', ViewerImageRenderable],
]

describe.each(kinds)('a %s on Warp with Kitty capabilities', (_name, kind) => {
  test('translated up four rows forwards only the bottom half as native kitty pixels', async () => {
    await withPicture({
      kind,
      run: async ({ scene, node }) => {
        const drawn = await translate({ scene, node, y: -4 })

        expect(node.height).toBe(8)
        expect(drawn?.protocol).toBe('kitty')
        expect(drawn?.destination).toEqual([0, 0, 8, 4])
        expect(drawn?.source).toEqual([0, 0, 16, 16])
        expect(drawn && [drawn.image.width, drawn.image.height]).toEqual([16, 16])
        expect(drawn && bandsOf(drawn.image)).toEqual(['blue', 'yellow'])
      },
    })
  })

  test('translated up two rows forwards the last three bands at six rows', async () => {
    await withPicture({
      kind,
      run: async ({ scene, node }) => {
        const drawn = await translate({ scene, node, y: -2 })

        expect(drawn?.destination).toEqual([0, 0, 8, 6])
        expect(drawn?.source).toEqual([0, 0, 16, 24])
        expect(drawn && bandsOf(drawn.image)).toEqual(['green', 'blue', 'yellow'])
      },
    })
  })

  test('running past the bottom of the root forwards the top bands', async () => {
    await withPicture({
      kind,
      run: async ({ scene, node }) => {
        const drawn = await translate({ scene, node, y: 16 })

        expect(drawn?.destination).toEqual([0, 16, 8, 4])
        expect(drawn && [drawn.image.width, drawn.image.height]).toEqual([16, 16])
        expect(drawn && bandsOf(drawn.image)).toEqual(['red', 'green'])
      },
    })
  })

  test('an overflow-hidden parent shorter than the picture selects the top bands', async () => {
    await withPicture({
      kind,
      parentOf: (scene) => {
        const parent = new BoxRenderable(scene.renderer, { width: 20, height: 4, overflow: 'hidden' })
        scene.renderer.root.add(parent)
        return parent
      },
      run: async ({ scene, node }) => {
        const drawn = draw({ scene, node })

        expect(drawn?.destination).toEqual([0, 0, 8, 4])
        expect(drawn && bandsOf(drawn.image)).toEqual(['red', 'green'])
      },
    })
  })

  test('a narrow nested scroller crops columns and rows together', async () => {
    const scrollers: ScrollBoxRenderable[] = []
    await withPicture({
      kind,
      parentOf: (scene) => {
        const outer = new BoxRenderable(scene.renderer, { width: 4, height: 6, overflow: 'hidden' })
        const scroll = new ScrollBoxRenderable(scene.renderer, { width: 20, height: 6, scrollY: true })
        scene.renderer.root.add(outer)
        outer.add(scroll)
        scrollers.push(scroll)
        return scroll
      },
      run: async ({ scene, node }) => {
        scrollers[0]?.scrollTo(2)
        await scene.renderOnce()
        const drawn = draw({ scene, node })

        expect(drawn?.destination.slice(2)).toEqual([4, 6])
        expect(drawn && [drawn.image.width, drawn.image.height]).toEqual([8, 24])
        expect(drawn?.source).toEqual([0, 0, 8, 24])
        expect(drawn && bandsOf(drawn.image)).toEqual(['green', 'blue', 'yellow'])
      },
    })
  })
})

describe('a picture on a terminal that is not Warp', () => {
  test('explicit kitty forwards the original image and leaves the source rectangle to native', async () => {
    await withPicture({
      kind: TranscriptImageRenderable,
      program: 'iTerm.app',
      protocol: 'kitty',
      run: async ({ scene, node }) => {
        const drawn = await translate({ scene, node, y: -4 })

        expect(drawn?.image).toBe(node.image as NativeImage)
        expect(drawn?.protocol).toBe('kitty')
        expect(drawn?.source).toEqual([0, 0, 16, 32])
        expect(drawn?.destination).toEqual([0, -4, 8, 8])
      },
    })
  })
})

describe('the prepared Warp image', () => {
  test('is the same native image on repeated paints of one crop, without requesting renders', async () => {
    await withPicture({
      kind: TranscriptImageRenderable,
      run: async ({ scene, node }) => {
        const first = await translate({ scene, node, y: -4 })
        const request = node.requestRender.bind(node)
        let requests = 0
        node.requestRender = () => {
          requests += 1
          request()
        }
        const pointers = [first?.image.ptr]
        for (let paint = 0; paint < 4; paint += 1) pointers.push(draw({ scene, node })?.image.ptr)

        expect(new Set(pointers).size).toBe(1)
        expect(requests).toBe(0)
      },
    })
  })

  test('is replaced when the crop changes', async () => {
    await withPicture({
      kind: TranscriptImageRenderable,
      run: async ({ scene, node }) => {
        const four = await translate({ scene, node, y: -4 })
        const fourPointer = four?.image.ptr
        const two = await translate({ scene, node, y: -2 })

        expect(two?.image.ptr).not.toBe(fourPointer)
        expect(two && bandsOf(two.image)).toEqual(['green', 'blue', 'yellow'])
      },
    })
  })

  test('is replaced when the picture is hidden and shown again', async () => {
    await withPicture({
      kind: TranscriptImageRenderable,
      run: async ({ scene, node }) => {
        const before = await translate({ scene, node, y: -4 })
        const stale = before?.image
        const stalePointer = stale?.ptr
        await translate({ scene, node, y: -20 })
        const after = await translate({ scene, node, y: -4 })

        expect(after?.image.ptr).not.toBe(stalePointer)
        expect(() => stale?.ptr).toThrow()
      },
    })
  })

  test('is disposed when the renderer is destroyed', async () => {
    await withPicture({
      kind: TranscriptImageRenderable,
      run: async ({ scene, node }) => {
        const prepared = (await translate({ scene, node, y: -4 }))?.image

        scene.renderer.destroy()

        expect(() => prepared?.ptr).toThrow()
      },
    })
  })

  test('follows a replaced source', async () => {
    const replacement = bandedImage(['yellow', 'blue', 'green', 'red'])
    try {
      await withPicture({
        kind: TranscriptImageRenderable,
        run: async ({ scene, node }) => {
          const original = await translate({ scene, node, y: -4 })
          const originalBands = original && bandsOf(original.image)
          node.source = replacement
          await node.loadPromise
          await scene.renderOnce()

          expect(originalBands).toEqual(['blue', 'yellow'])
          expect(bandsOf(draw({ scene, node })?.image ?? replacement)).toEqual(['green', 'red'])
        },
      })
    } finally {
      replacement.dispose()
    }
  })

  test('follows a resize of the picture', async () => {
    await withPicture({
      kind: TranscriptImageRenderable,
      run: async ({ scene, node }) => {
        const before = await translate({ scene, node, y: -4 })
        node.height = 16
        node.width = 16
        await scene.renderOnce()
        const after = draw({ scene, node })

        expect(before?.destination).toEqual([0, 0, 8, 4])
        expect(after?.destination).toEqual([0, 0, 16, 12])
        expect(after && [after.image.width, after.image.height]).toEqual([16, 24])
      },
    })
  })

  test('follows a change of fit to cover', async () => {
    await withPicture({
      kind: TranscriptImageRenderable,
      run: async ({ scene, node }) => {
        node.width = 16
        const fit = await translate({ scene, node, y: -4 })
        const fitBands = fit && bandsOf(fit.image)
        node.fit = 'cover'
        await scene.renderOnce()
        const cover = draw({ scene, node })

        expect(fitBands).toEqual(['blue', 'yellow'])
        expect(cover && bandsOf(cover.image)).toEqual(['blue'])
      },
    })
  })
})
