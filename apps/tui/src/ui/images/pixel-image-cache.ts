import type { NativeImage } from '@opentui/core'

import type { ClippedImagePlacement } from './image-placement'

const KITTY_DOWNSCALE_AREA_RATIO = 4

export class PixelImageCache {
  private source: NativeImage | null = null
  private key = ''
  private prepared: NativeImage | null = null

  imageFor(args: { image: NativeImage; placement: ClippedImagePlacement }): NativeImage {
    const { source, pixels } = args.placement
    const key = `${source.x}:${source.y}:${source.width}:${source.height}:${pixels.width}:${pixels.height}`
    if (this.source === args.image && this.key === key && this.prepared !== null)
      return this.prepared

    const full =
      source.x === 0 &&
      source.y === 0 &&
      source.width === args.image.width &&
      source.height === args.image.height
    let prepared = full
      ? args.image.retain()
      : args.image.extract({
          left: source.x,
          top: source.y,
          width: source.width,
          height: source.height,
        })
    try {
      const pixelArea = pixels.width * pixels.height
      if (
        pixelArea > 0 &&
        prepared.width * prepared.height >= pixelArea * KITTY_DOWNSCALE_AREA_RATIO
      ) {
        const resized = prepared.resize({
          width: pixels.width,
          height: pixels.height,
          kernel: 'area',
        })
        prepared.dispose()
        prepared = resized
      }
      prepared.ensureEncodedPng()
    } catch (error) {
      prepared.dispose()
      throw error
    }
    this.clear()
    this.source = args.image
    this.key = key
    this.prepared = prepared
    return prepared
  }

  clear(): void {
    this.prepared?.dispose()
    this.prepared = null
    this.source = null
    this.key = ''
  }
}
